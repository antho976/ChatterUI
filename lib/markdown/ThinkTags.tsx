export const thinkTags = [
    {
        open: /^<think\b[^>]*>/,
        close: '</think>',
    },
    {
        open: /^<\|channel>thought/,
        close: '<channel|>',
    },
    {
        open: /^<seed:think>/,
        close: '</seed:think>',
    },
]

function escapeRegex(str: string) {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

export function buildThinkRules() {
    return thinkTags.map((tag) => {
        let openSource
        if (tag.open instanceof RegExp) {
            openSource = tag.open.source.replace(/^\^/, '')
        } else {
            openSource = escapeRegex(tag.open)
        }
        const closeSource = escapeRegex(tag.close)
        return {
            // a block without a closing tag (generation cut off mid-thought) is removed to
            // its end, otherwise it would be replayed as part of the reply
            macro: new RegExp(`${openSource}[\\s\\S]*?(?:${closeSource}|$)`, 'g'),
            value: '',
        }
    })
}
