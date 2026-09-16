import { AntDesign } from '@expo/vector-icons'
import { useLiveQuery } from 'drizzle-orm/expo-sqlite'
import { Redirect } from 'expo-router'
import { useState } from 'react'
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import { KeyboardAwareScrollView } from 'react-native-keyboard-controller'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useShallow } from 'zustand/react/shallow'

import ThemedButton from '@components/buttons/ThemedButton'
import DropdownSheet from '@components/input/DropdownSheet'
import ThemedTextInput from '@components/input/ThemedTextInput'
import Alert from '@components/views/Alert'
import HeaderTitle from '@components/views/HeaderTitle'
import { Chats } from '@lib/state/Chat'
import { ChatPresets } from '@lib/state/ChatPresets'
import { Logger } from '@lib/state/Logger'
import { Theme } from '@lib/theme/ThemeManager'
import { ChatPresetType } from 'db/schema'

type GiveTarget = Awaited<ReturnType<typeof ChatPresets.db.query.giveTargets>>[0]

const ChatPresetsScreen = () => {
    const styles = useStyles()
    const { color, spacing } = Theme.useTheme()
    const { chatId, activePresetId, setActivePreset } = Chats.useChatState(
        useShallow((state) => ({
            chatId: state.data?.id,
            activePresetId: state.data?.active_preset_id,
            setActivePreset: state.setActivePreset,
        }))
    )
    const { data: presets } = useLiveQuery(ChatPresets.db.query.presetsForChatQuery(chatId ?? -1), [
        chatId,
    ])

    const [editing, setEditing] = useState<
        { id?: number; data: ChatPresets.ChatPresetEdit } | undefined
    >()
    const [giving, setGiving] = useState<
        { preset: ChatPresetType; targets: GiveTarget[] } | undefined
    >()

    if (!chatId) return <Redirect href=".." />

    const isOwner = (preset: ChatPresetType) => preset.owner_chat_id === chatId

    const handleActivate = async (preset: ChatPresetType) => {
        const next = activePresetId === preset.id ? null : preset.id
        await setActivePreset(chatId, next)
    }

    const handleSave = async () => {
        if (!editing) return
        const data = { ...editing.data, name: editing.data.name.trim() }
        if (!data.name) {
            Logger.errorToast('Preset name cannot be empty')
            return
        }
        if (editing.id) {
            await ChatPresets.db.mutate.updatePreset(editing.id, data)
            Logger.infoToast('Preset saved')
        } else {
            const id = await ChatPresets.db.mutate.createPreset(chatId, data)
            await setActivePreset(chatId, id)
            Logger.infoToast('Preset created and activated')
        }
        setEditing(undefined)
    }

    const handleDelete = (preset: ChatPresetType) => {
        Alert.alert({
            title: 'Delete Preset',
            description: `Delete '${preset.name}'? Chats it was given to lose it as well.`,
            buttons: [
                { label: 'Cancel' },
                {
                    label: 'Delete',
                    type: 'warning',
                    onPress: async () => {
                        await ChatPresets.db.mutate.deletePreset(preset.id)
                        if (activePresetId === preset.id) await setActivePreset(chatId, null)
                    },
                },
            ],
        })
    }

    const handleRemoveFromChat = (preset: ChatPresetType) => {
        Alert.alert({
            title: 'Remove Preset',
            description: `Remove '${preset.name}' from this chat? The owner chat keeps it.`,
            buttons: [
                { label: 'Cancel' },
                {
                    label: 'Remove',
                    type: 'warning',
                    onPress: async () => {
                        await ChatPresets.db.mutate.removeFromChat(preset.id, chatId)
                        if (activePresetId === preset.id) await setActivePreset(chatId, null)
                    },
                },
            ],
        })
    }

    const handleOpenGive = async (preset: ChatPresetType) => {
        const targets = await ChatPresets.db.query.giveTargets(preset.id, chatId)
        if (targets.length === 0) {
            Logger.infoToast('No other chats of this character to give this preset to')
            return
        }
        setGiving({ preset, targets })
    }

    const handleGive = async (target: GiveTarget) => {
        if (!giving) return
        await ChatPresets.db.mutate.giveToChat(giving.preset.id, target.id)
        Logger.infoToast(`Given to '${target.name}'`)
        setGiving(undefined)
    }

    const renderEditor = () => {
        if (!editing) return null
        const { data } = editing
        const update = (patch: Partial<ChatPresets.ChatPresetEdit>) =>
            setEditing({ ...editing, data: { ...data, ...patch } })
        return (
            <View style={styles.card}>
                <Text style={styles.cardTitle}>{editing.id ? 'Edit Preset' : 'New Preset'}</Text>
                <ThemedTextInput
                    label="Name"
                    value={data.name}
                    onChangeText={(name) => update({ name })}
                />
                <ThemedTextInput
                    label="System Prompt"
                    description="Replaces the system prompt for this chat. Use {{original}} to include the card or Formatting prompt. Leave blank to keep it."
                    multiline
                    numberOfLines={6}
                    value={data.system_prompt}
                    onChangeText={(system_prompt) => update({ system_prompt })}
                />
                <ThemedTextInput
                    label="Persona"
                    description="Replaces the User description for this chat. Leave blank to keep the current User."
                    multiline
                    numberOfLines={6}
                    value={data.persona}
                    onChangeText={(persona) => update({ persona })}
                />
                <ThemedTextInput
                    label="Rules"
                    description="Sent after the chat history so they are followed closely. Replaces the character's rules. Leave blank to keep them."
                    multiline
                    numberOfLines={6}
                    value={data.rules}
                    onChangeText={(rules) => update({ rules })}
                />
                <View style={styles.row}>
                    <ThemedButton
                        label="Cancel"
                        variant="secondary"
                        onPress={() => setEditing(undefined)}
                    />
                    <ThemedButton label="Save" iconName="save" onPress={handleSave} />
                </View>
            </View>
        )
    }

    const renderPreset = (preset: ChatPresetType) => {
        const active = preset.id === activePresetId
        const owner = isOwner(preset)
        return (
            <View key={preset.id} style={[styles.card, active && styles.cardActive]}>
                <TouchableOpacity
                    style={styles.presetHeader}
                    onPress={() => handleActivate(preset)}>
                    <AntDesign
                        name={active ? 'check-circle' : 'minus-circle'}
                        size={22}
                        color={active ? color.primary._500 : color.text._600}
                    />
                    <View style={{ flex: 1 }}>
                        <Text style={styles.presetName}>{preset.name}</Text>
                        <Text style={styles.presetMeta}>
                            {owner ? 'Created in this chat' : 'Given by another chat'}
                            {active ? '  ·  Active' : ''}
                        </Text>
                    </View>
                </TouchableOpacity>
                <Text style={styles.presetPreview} numberOfLines={2}>
                    {[
                        preset.system_prompt && 'System prompt',
                        preset.persona && 'Persona',
                        preset.rules && 'Rules',
                    ]
                        .filter((item) => item)
                        .join(', ') || 'Empty preset'}
                </Text>
                <View style={styles.row}>
                    {owner ? (
                        <>
                            <ThemedButton
                                label="Edit"
                                iconName="edit"
                                variant="secondary"
                                onPress={() =>
                                    setEditing({
                                        id: preset.id,
                                        data: {
                                            name: preset.name,
                                            system_prompt: preset.system_prompt,
                                            persona: preset.persona,
                                            rules: preset.rules,
                                        },
                                    })
                                }
                            />
                            <ThemedButton
                                label="Give"
                                iconName="export"
                                variant="secondary"
                                onPress={() => handleOpenGive(preset)}
                            />
                            <ThemedButton
                                label="Delete"
                                iconName="delete"
                                variant="critical"
                                onPress={() => handleDelete(preset)}
                            />
                        </>
                    ) : (
                        <ThemedButton
                            label="Remove From Chat"
                            iconName="close"
                            variant="critical"
                            onPress={() => handleRemoveFromChat(preset)}
                        />
                    )}
                </View>
            </View>
        )
    }

    return (
        <SafeAreaView edges={['bottom']} style={{ flex: 1 }}>
            <HeaderTitle title="Chat Presets" />
            <KeyboardAwareScrollView
                bottomOffset={16}
                showsVerticalScrollIndicator={false}
                keyboardShouldPersistTaps="always"
                contentContainerStyle={styles.container}>
                <Text style={styles.hint}>
                    A preset bundles a system prompt, persona and rules for this chat. Presets are
                    only shown in the chat they were created in and in chats they were given to.
                    Only the original chat can edit, delete or give a preset.
                </Text>

                {giving && (
                    <View style={styles.card}>
                        <Text style={styles.cardTitle}>{`Give "${giving.preset.name}" to`}</Text>
                        <DropdownSheet
                            data={giving.targets}
                            labelExtractor={(item) => item.name}
                            onChangeValue={handleGive}
                            placeholder="Select a chat..."
                            modalTitle="Give Preset To Chat"
                            search
                        />
                        <ThemedButton
                            label="Cancel"
                            variant="secondary"
                            onPress={() => setGiving(undefined)}
                        />
                    </View>
                )}

                {renderEditor()}

                {!editing && (
                    <ThemedButton
                        label="New Preset"
                        iconName="plus"
                        onPress={() => setEditing({ data: ChatPresets.blankPreset() })}
                    />
                )}

                {presets.length === 0 && !editing && (
                    <Text style={styles.empty}>No presets in this chat yet.</Text>
                )}
                {presets.map(renderPreset)}
                <View style={{ height: spacing.xl3 }} />
            </KeyboardAwareScrollView>
        </SafeAreaView>
    )
}

export default ChatPresetsScreen

const useStyles = () => {
    const { color, spacing, borderRadius, fontSize, borderWidth } = Theme.useTheme()
    return StyleSheet.create({
        container: {
            paddingHorizontal: spacing.xl,
            paddingTop: spacing.m,
            rowGap: spacing.l,
        },
        hint: {
            color: color.text._500,
            fontSize: fontSize.s,
        },
        empty: {
            color: color.text._500,
            fontStyle: 'italic',
            textAlign: 'center',
            paddingVertical: spacing.xl,
        },
        card: {
            backgroundColor: color.neutral._100,
            borderRadius: borderRadius.m,
            borderWidth: borderWidth.m,
            borderColor: color.neutral._200,
            padding: spacing.l,
            rowGap: spacing.m,
        },
        cardActive: {
            borderColor: color.primary._500,
        },
        cardTitle: {
            color: color.text._100,
            fontSize: fontSize.l,
        },
        presetHeader: {
            flexDirection: 'row',
            alignItems: 'center',
            columnGap: spacing.l,
        },
        presetName: {
            color: color.text._100,
            fontSize: fontSize.l,
        },
        presetMeta: {
            color: color.text._500,
            fontSize: fontSize.s,
        },
        presetPreview: {
            color: color.text._400,
            fontSize: fontSize.s,
        },
        row: {
            flexDirection: 'row',
            columnGap: spacing.m,
            justifyContent: 'flex-end',
            flexWrap: 'wrap',
            rowGap: spacing.m,
        },
    })
}
