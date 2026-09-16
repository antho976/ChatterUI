import { AppSettings } from '@lib/constants/GlobalValues'
import { buildThinkRules } from '@lib/markdown/ThinkTags'
import { CharacterCardData, CharacterTokenCache } from '@lib/state/Characters'
import { ChatEntry } from '@lib/state/Chat'
import { defaultSystemPromptFormat, InstructTokenCache, InstructType } from '@lib/state/Instructs'
import { Logger } from '@lib/state/Logger'
import { replaceMacros } from '@lib/state/Macros'
import { mmkv } from '@lib/storage/MMKV'
import { readBase64Async } from '@lib/utils/File'
import { Macro } from '@lib/utils/Macros'

import { APIConfiguration, APIValues } from './APIBuilder.types'

export type MessageLoader = {
    retrieve: (limit: number, offset: number) => Promise<ChatEntry[]>
    initialLimit: number
    initialOffset: number
}

export type TokenCache = {
    userCache: CharacterTokenCache
    characterCache: CharacterTokenCache
    instructCache: InstructTokenCache
}

export interface ContextBuilderParams {
    apiConfig: APIConfiguration
    apiValues: APIValues
    messages: ChatEntry[]
    character: CharacterCardData
    instruct: InstructType
    user: CharacterCardData
    tokenizer: (data: string, media_paths?: string[]) => Promise<number> | number
    chatTokenizer: (entry: ChatEntry, index: number) => Promise<number>
    maxLength: number
    cache: TokenCache
    bypassContextLength?: boolean
    messageLoader?: MessageLoader
    /** per-chat memory notes, injected after the chat history */
    chatMemory?: string
}

type ContentTypes =
    | { type: 'input_text' | 'text'; text: string }
    | { type: 'image_url'; image_url: { url: string } }
    | { type: 'input_audio'; input_audio: { data: string; format: string } }

export type Message = { role: string; [x: string]: ContentTypes[] | string }

export const buildContext = async (params: ContextBuilderParams) => {
    if (params.apiConfig.request.completionType.type === 'chatCompletions') {
        return await buildChatCompletionContext(params)
    } else {
        return await buildTextCompletionContext(params)
    }
}

/**
 * TODO:
 * Context Builder is not a pure function:
 * - Macros rely on macro state
 */

export const buildChatCompletionContext = async ({
    apiConfig,
    apiValues,
    messages,
    character,
    user,
    cache,
    instruct,
    tokenizer,
    chatTokenizer,
    maxLength,
    bypassContextLength,
    messageLoader,
    chatMemory,
}: ContextBuilderParams) => {
    const delta = performance.now()

    if (apiConfig.request.completionType.type !== 'chatCompletions') return
    const completionFeats = apiConfig.request.completionType
    const { characterCache, userCache, instructCache } = cache
    const usePrefix = false
    const { systemPrompt, systemPromptLength } = getSystemPrompt({
        instruct,
        user,
        character,
        userCache,
        characterCache,
        instructCache,
        usePrefix,
    })

    const initial = systemPrompt
    let total_length = systemPromptLength
    let first_message_reached = false

    // post-history note (chat memory + card rules) is reserved before history is added
    const postHistory = await getPostHistoryNote({
        instruct,
        character,
        characterCache,
        chatMemory,
        tokenizer,
    })
    total_length += postHistory.length

    const payload: Message[] = [
        {
            role: completionFeats.systemRole,
            [completionFeats.contentName]: replaceMacrosInternal(initial, instruct),
        },
    ]
    let hasImage = false
    const messageBuffer: Message[] = []
    let index = messages.length - 1
    // the note goes before the reply being written, even when continuing a partial reply
    let lastMessageIncluded = false
    for (const message of [...messages].reverse()) {
        const swipe_data = message.swipes[message.swipe_id]
        // special case for claude, prefill may be useful!
        const timestamp_string = `[${swipe_data.send_date.toString().split(' ')[0]} ${swipe_data.send_date.toLocaleTimeString()}]\n`
        const timestamp_length = instruct.timestamp ? await tokenizer(timestamp_string) : 0

        const name_string = `${message.name} :`
        const name_length = instruct.names ? await tokenizer(name_string) : 0
        const { attachments, hasImageNew } = getValidAttachments(
            message,
            completionFeats,
            instruct,
            hasImage
        )

        const swipe_len = message.id !== -1 ? await chatTokenizer(message, index) : 0
        const len = swipe_len + name_length + timestamp_length

        if (total_length + len > maxLength && !bypassContextLength) break
        hasImage = hasImageNew

        const prefill = index === messages.length - 1 ? apiValues.prefill : ''

        if (!swipe_data.swipe && !prefill && index === messages.length - 1) {
            index--
            continue
        }
        const role = message.is_user ? completionFeats.userRole : completionFeats.assistantRole

        if (message.attachments.length > 0) {
            Logger.warn('Image output is incomplete')

            const images: ContentTypes[] = await Promise.all(
                attachments.map(async (item) => {
                    const base64data = await readBase64Async(item.uri)
                    if (item.type === 'image')
                        return {
                            type: 'image_url',
                            image_url: {
                                url: 'data:' + item.mime_type + ';base64,' + base64data,
                            },
                        }
                    return {
                        type: 'input_audio',
                        input_audio: {
                            data: base64data,
                            format: item.mime_type.split('/')[1],
                        },
                    }
                })
            )

            messageBuffer.push({
                role: role,
                [completionFeats.contentName]: [
                    {
                        type: 'text',
                        text: replaceMacrosInternal(prefill + swipe_data.swipe, instruct),
                    },
                    ...images,
                ],
            })
        } else {
            messageBuffer.push({
                role: role,
                [completionFeats.contentName]: replaceMacrosInternal(
                    prefill + swipe_data.swipe,
                    instruct
                ),
            })
        }
        first_message_reached = index === 0
        if (index === messages.length - 1 && !message.is_user) lastMessageIncluded = true
        total_length += len
        index--
    }

    if (index >= messages.length - 1 && messages.length !== 0) {
        warnNoMessages()
    }

    if (postHistory.text) {
        // messageBuffer is newest-first: index 0 is the partial reply when continuing
        messageBuffer.splice(lastMessageIncluded ? 1 : 0, 0, {
            role: completionFeats.systemRole,
            [completionFeats.contentName]: postHistory.text,
        })
    }

    const examples = character?.mes_example
    if (
        first_message_reached &&
        instruct.examples &&
        examples &&
        total_length + characterCache.examples_length < maxLength
    ) {
        payload[0][completionFeats.contentName] += replaceMacrosInternal(examples, instruct)
        total_length += characterCache.examples_length
    }

    if (apiConfig.features.useFirstMessage && apiValues.firstMessage)
        messageBuffer.push({
            role: completionFeats.userRole,
            [completionFeats.contentName]: apiValues.firstMessage,
        })

    const output = [...payload, ...messageBuffer.reverse()]
    Logger.info(`Approximate Context Size: ${total_length} tokens`)
    Logger.info(`${(performance.now() - delta).toFixed(2)}ms taken to build context`)
    if (mmkv.getBoolean(AppSettings.PrintContext)) Logger.info(JSON.stringify(output))

    return output
}

export const buildTextCompletionContext = async ({
    apiConfig,
    apiValues,
    messages,
    character,
    user,
    cache,
    instruct,
    tokenizer,
    chatTokenizer,
    maxLength,
    bypassContextLength,
    messageLoader,
    chatMemory,
}: ContextBuilderParams) => {
    const delta = performance.now()
    const useSuffix = false
    const { characterCache, userCache, instructCache } = cache

    const { systemPrompt, systemPromptLength } = getSystemPrompt({
        instruct,
        user,
        character,
        userCache,
        characterCache,
        instructCache,
        useSuffix,
    })

    let payload = systemPrompt
    let payloadLength = systemPromptLength

    // post-history note (chat memory + card rules) is placed right before the reply
    const postHistory = await getPostHistoryNote({
        instruct,
        character,
        characterCache,
        chatMemory,
        tokenizer,
    })
    let note_shard = ''
    if (postHistory.text) {
        note_shard = instruct.system_prefix + postHistory.text + instruct.system_suffix
        if (instruct.wrap) note_shard += '\n'
        payloadLength +=
            postHistory.length +
            instructCache.system_prefix_length +
            instructCache.system_suffix_length
    }

    // suffix must be delayed for example messages
    let message_acc = ``
    // the shard of the reply being written, kept apart so the note can precede it
    let last_shard = ``
    let message_acc_length = 0
    let is_last = true
    let index = messages.length - 1

    const wrap_string = `\n`
    const wrap_length = instruct.wrap ? await tokenizer(wrap_string) : 0

    // we use this to check if the first message is reached
    // this is needed to check if examples should be added
    let first_message_reached = false

    // we require lengths for names if use_names is enabled
    for (const message of [...messages].reverse()) {
        const swipe_len = await chatTokenizer(message, index)
        const swipe_data = message.swipes[message.swipe_id]

        /** Accumulate total string length
         *  The context builder MUST retain context length below the
         *  context limit, especially for local gens to prevent truncation
         * **/

        let instruct_len = message.is_user
            ? instructCache.input_prefix_length
            : is_last
              ? instructCache.last_output_prefix_length
              : instructCache.output_suffix_length

        // for last message, we want to skip the end token to allow the LLM to generate

        if (!is_last)
            instruct_len += message.is_user
                ? instructCache.input_suffix_length
                : instructCache.output_suffix_length

        const timestamp_string = `[${swipe_data.send_date.toString().split(' ')[0]} ${swipe_data.send_date.toLocaleTimeString()}]\n`
        const timestamp_length = instruct.timestamp ? await tokenizer(timestamp_string) : 0

        const name_string = `${message.name}: `
        const name_length = instruct.names ? await tokenizer(name_string) : 0

        const shard_length = swipe_len + instruct_len + name_length + timestamp_length + wrap_length

        // check if within context window
        if (message_acc_length + payloadLength + shard_length > maxLength && !bypassContextLength) {
            break
        }

        // apply strings

        let message_shard = message.is_user
            ? instruct.input_prefix
            : is_last
              ? instruct.last_output_prefix
              : instruct.output_prefix

        if (instruct.timestamp) message_shard += timestamp_string

        if (instruct.names) message_shard += name_string

        message_shard += swipe_data.swipe

        if (!is_last) {
            message_shard += `${message.is_user ? instruct.input_suffix : instruct.output_suffix}`
        }

        if (instruct.wrap) {
            message_shard += wrap_string
        }

        first_message_reached = index === 0

        message_acc_length += shard_length
        if (is_last && !message.is_user) last_shard = message_shard
        else message_acc = message_shard + message_acc
        // ensure no more is_last checks after this
        is_last = false
        index--
    }

    if (index >= messages.length - 1 && messages.length !== 0) {
        warnNoMessages()
    }

    const examples = character?.mes_example
    if (
        first_message_reached &&
        instruct.examples &&
        examples &&
        message_acc_length + payloadLength + characterCache.examples_length < maxLength
    ) {
        payload += examples
        message_acc_length += characterCache.examples_length
    }

    payload += instruct.system_suffix
    payload = replaceMacrosInternal(payload + message_acc + note_shard + last_shard, instruct)

    Logger.info(`Approximate Context Size: ${message_acc_length + payloadLength} tokens`)
    Logger.info(`${(performance.now() - delta).toFixed(2)}ms taken to build context`)

    if (mmkv.getBoolean(AppSettings.PrintContext)) Logger.info(payload)

    return payload
}

const thinkRule = buildThinkRules()

const getMacroRules = (instruct: InstructType) => {
    const data: Macro[] = []
    if (instruct.hide_think_tags) {
        // strips reasoning blocks from history so they never feed back into the model
        data.push(...thinkRule)
    }
    // for expansion
    return data
}

/**
 * Builds the note sent after the chat history: chat memory first, then the card's
 * post-history instructions. Being the last thing before the reply, it is followed closely.
 */
const getPostHistoryNote = async ({
    instruct,
    character,
    characterCache,
    chatMemory,
    tokenizer,
}: {
    instruct: InstructType
    character?: CharacterCardData
    characterCache: CharacterTokenCache
    chatMemory?: string
    tokenizer: ContextBuilderParams['tokenizer']
}) => {
    const parts: string[] = []
    let length = 0
    const memory = chatMemory?.trim() ?? ''
    if (memory) {
        const memoryText = replaceMacrosInternal(`[Memory]\n${memory}`, instruct)
        parts.push(memoryText)
        length += await tokenizer(memoryText)
    }
    const rules = character?.post_history_instructions?.trim() ?? ''
    if (instruct.use_post_history && rules) {
        parts.push(replaceMacrosInternal(rules, instruct))
        length += characterCache.post_history_length
    }
    return { text: parts.join('\n\n'), length: length }
}

const replaceMacrosInternal = (data: string, instruct: InstructType) => {
    return replaceMacros(data, { extraMacros: getMacroRules(instruct) })
}

const getValidAttachments = (
    entry: ChatEntry,
    config: {
        type: 'chatCompletions'
        userRole: string
        systemRole: string
        assistantRole: string
        contentName: string
        supportsAudio?: boolean
        supportsImages?: boolean
    },
    instruct: InstructType,
    hasImage: boolean
) => {
    let hasImageNew = hasImage
    const audioAttachments = entry.attachments.filter(
        (item) => item.type === 'audio' && instruct.send_audio && config.supportsAudio
    )

    let imageAttachments: typeof entry.attachments = []
    if (instruct.send_images && config.supportsImages) {
        const images = entry.attachments.filter((item) => item.type === 'image')
        if (instruct.last_image_only && images.length > 0) {
            if (!hasImageNew) {
                hasImageNew = true
                imageAttachments = [images[0]]
            }
        } else {
            imageAttachments = images
        }
    }
    const attachments = [...audioAttachments, ...imageAttachments]
    return { hasImageNew, attachments }
}

export const getSystemPrompt = ({
    instruct,
    user,
    character,
    userCache,
    characterCache,
    instructCache,
    usePrefix = true,
    useSuffix = true,
}: {
    instruct: InstructType
    user?: CharacterCardData
    character?: CharacterCardData
    userCache: CharacterTokenCache
    characterCache: CharacterTokenCache
    instructCache: InstructTokenCache
    usePrefix?: boolean
    useSuffix?: boolean
}) => {
    let systemPrompt = instruct.system_prompt_format
    if (systemPrompt === undefined) {
        Logger.warn('System Prompt Format is undefined, falling back to default')
        systemPrompt = defaultSystemPromptFormat
    }
    if (systemPrompt === '') {
        Logger.warn('System Prompt Format is blank')
    }

    let systemPromptLength = 0

    // a card may define its own system prompt, {{original}} inserts the instruct's prompt
    const instructSystemPrompt = instruct.system_prompt ?? ''
    const cardSystemPrompt = character?.system_prompt?.trim() ?? ''
    const useCardPrompt = instruct.use_card_system_prompt && cardSystemPrompt.length > 0
    const finalSystemPrompt = useCardPrompt
        ? cardSystemPrompt.replaceAll('{{original}}', instructSystemPrompt)
        : instructSystemPrompt
    const finalSystemPromptLength = useCardPrompt
        ? characterCache.system_prompt_length +
          (cardSystemPrompt.includes('{{original}}') ? instructCache.system_prompt_length : 0)
        : instructCache.system_prompt_length

    const macros = [
        {
            macro: '{{system_prefix}}',
            value: (usePrefix && instruct.system_prefix) || '',
            length: instructCache.system_prefix_length,
        },
        {
            macro: '{{system_suffix}}',
            value: (useSuffix && instruct.system_suffix) || '',
            length: instructCache.system_suffix_length,
        },
        {
            macro: '{{system_prompt}}',
            value: finalSystemPrompt,
            length: finalSystemPromptLength,
        },
        {
            macro: '{{character_desc}}',
            value: character?.description ?? '',
            length: characterCache.description_length,
        },
        {
            macro: '{{user_desc}}',
            value: user?.description ?? '',
            length: userCache.description_length,
        },
        {
            macro: '{{personality}}',
            value: instruct.personality ? (character?.personality ?? '') : '',
            length: instruct.personality ? characterCache.personality_length : 0,
        },
        {
            macro: '{{scenario}}',
            value: instruct.scenario ? (character?.scenario ?? '') : '',
            length: instruct.scenario ? characterCache.scenario_length : 0,
        },
    ]
    macros.forEach((m) => {
        systemPrompt = systemPrompt.replaceAll(m.macro, m.value)
        systemPromptLength += m.length
    })
    return { systemPrompt, systemPromptLength }
}

const warnNoMessages = () => {
    Logger.warnToast('No messages added. Check Logs.')
    Logger.warn(
        'No messages were added to the context. This can be caused by:\n- Generated Length is too high, lower it in Formatting\n- Your context length is too low\n- Your first message is too long'
    )
}
