import { Ionicons } from '@expo/vector-icons'
import { useRouter } from 'expo-router'
import { StyleSheet } from 'react-native'
import { useShallow } from 'zustand/react/shallow'

import ContextMenu from '@components/views/ContextMenu'
import Drawer from '@components/views/Drawer'
import { Chats } from '@lib/state/Chat'
import { Theme } from '@lib/theme/ThemeManager'

const ChatOptions = () => {
    const router = useRouter()
    const styles = useStyles()

    const setShow = Drawer.useDrawerStore((state) => state.setShow)

    const setShowChat = (b: boolean) => {
        setShow(Drawer.ID.CHATLIST, b)
    }

    const { chatId, chatBackground } = Chats.useChatState(
        useShallow((state) => ({
            chatId: state.data?.id,
            chatBackground: state.data?.background_image,
        }))
    )

    return (
        <ContextMenu
            buttons={[
                {
                    onPress: (close) => {
                        close()
                        router.back()
                    },
                    label: 'Main Menu',
                    icon: 'backward',
                },
                {
                    onPress: (close) => {
                        close()
                        router.push('/screens/CharacterEditorScreen')
                    },
                    label: 'Edit Character',
                    icon: 'edit',
                },
                {
                    onPress: (close) => {
                        setShowChat(true)
                        close()
                    },
                    label: 'Chat History',
                    icon: 'paper-clip',
                },
                {
                    onPress: (close) => {
                        close()
                        router.push('/screens/ChatPresetsScreen')
                    },
                    label: 'Chat Presets',
                    icon: 'profile',
                    disabled: !chatId,
                },
                {
                    label: 'Chat Background',
                    icon: 'picture',
                    disabled: !chatId,
                    submenu: [
                        {
                            label: 'Set Background',
                            icon: 'picture',
                            onPress: async (close) => {
                                close()
                                if (chatId) await Chats.importBackground(chatId, chatBackground)
                            },
                        },
                        {
                            label: 'Remove Background',
                            icon: 'delete',
                            variant: 'warning',
                            disabled: !chatBackground,
                            onPress: async (close) => {
                                close()
                                if (chatId && chatBackground)
                                    await Chats.removeBackground(chatId, chatBackground)
                            },
                        },
                    ],
                },
            ]}
            placement="top">
            <Ionicons name="caret-up" style={styles.optionsButton} size={24} />
        </ContextMenu>
    )
}

export default ChatOptions

const useStyles = () => {
    const { color } = Theme.useTheme()

    return StyleSheet.create({
        optionsButton: {
            color: color.text._500,
            padding: 4,
            backgroundColor: color.neutral._200,
            borderRadius: 16,
        },
    })
}
