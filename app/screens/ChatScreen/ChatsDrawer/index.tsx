import { FlashList } from '@shopify/flash-list'
import { useLiveQuery } from 'drizzle-orm/expo-sqlite'
import { authenticateAsync } from 'expo-local-authentication'
import { useState } from 'react'
import { StyleSheet, Text, View } from 'react-native'
import { useMMKVBoolean } from 'react-native-mmkv'
import Animated, { FadeIn, FadeOut } from 'react-native-reanimated'
import { useShallow } from 'zustand/react/shallow'

import ThemedButton from '@components/buttons/ThemedButton'
import ThemedTextInput from '@components/input/ThemedTextInput'
import Drawer from '@components/views/Drawer'
import { YAxisOnlyTransition } from '@lib/animations/transitions'
import { AppSettings } from '@lib/constants/GlobalValues'
import { useDebounce } from '@lib/hooks/Debounce'
import { Characters } from '@lib/state/Characters'
import { Chats } from '@lib/state/Chat'
import { useChatsDrawerStore } from '@lib/state/components/ChatsDrawer'
import { Logger } from '@lib/state/Logger'
import { Theme } from '@lib/theme/ThemeManager'

import ChatDrawerItem from './ChatDrawerItem'
import ChatDrawerSearchItem from './ChatDrawerSearchItem'

const ChatsDrawer = () => {
    const styles = useStyles()
    const { color } = Theme.useTheme()
    const { charId } = Characters.useCharacterStore(useShallow((state) => ({ charId: state.id })))
    const { revealHidden, setRevealHidden } = useChatsDrawerStore(
        useShallow((state) => ({
            revealHidden: state.revealHidden,
            setRevealHidden: state.setRevealHidden,
        }))
    )
    const [lockApp] = useMMKVBoolean(AppSettings.LocallyAuthenticateUser)
    const { data } = useLiveQuery(Chats.db.query.chatListQuery(charId ?? 0, revealHidden), [
        charId,
        revealHidden,
    ])
    const setShow = Drawer.useDrawerStore((state) => state.setShow)
    const setShowDrawer = (b: boolean) => {
        setShow(Drawer.ID.CHATLIST, b)
    }

    const { loadChat } = Chats.useChat()

    const [searchResults, setSearchResults] = useState<
        Awaited<ReturnType<typeof Chats.db.query.searchChat>>
    >([])

    const [showSearchBar, setShowSearchBar] = useState(false)
    const [showSearchResults, setShowSearchResults] = useState(false)
    const [searchQuery, setSearchQuery] = useState('')

    const handleLoadChat = async (
        chatId: number,
        setOffset?: { type: 'index' | 'entryId'; value: number }
    ) => {
        await loadChat(chatId, setOffset)
        setShowDrawer(false)
    }

    const search = useDebounce(async (query: string, charId?: number) => {
        if (!charId || !query) return
        const results = await Chats.db.query.searchChat(query, charId).catch((e) => {
            Logger.error('Failed to run query: ' + e)
            return []
        })
        setSearchResults(results.sort((a, b) => b.sendDate.getTime() - a.sendDate.getTime()))
        setShowSearchResults(true)
    }, 500)

    const setSearch = (query: string) => {
        setSearchQuery(query)
        search(query, charId)
    }

    const handleCreateChat = async (ghost: boolean = false) => {
        if (charId)
            Chats.db.mutate.createChat(charId, { ghost }).then((chatId) => {
                if (chatId) handleLoadChat(chatId)
                if (chatId && ghost)
                    Logger.infoToast('Ghost chat started. It is erased when you leave it.')
            })
    }

    const handleToggleHidden = async () => {
        if (revealHidden) {
            setRevealHidden(false)
            return
        }
        // when the app is locked, revealing hidden chats requires the same authentication
        if (lockApp) {
            const result = await authenticateAsync({
                promptMessage: 'Reveal Hidden Chats',
            })
            if (!result.success) {
                Logger.warnToast('Authentication Failed')
                return
            }
        }
        setRevealHidden(true)
    }

    return (
        <Drawer.Body drawerID={Drawer.ID.CHATLIST} drawerStyle={styles.drawer} direction="right">
            <View
                style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 }}>
                <Text style={styles.drawerTitle}>{showSearchBar ? 'Search' : 'Chats'}</Text>
                <View style={{ flexDirection: 'row', columnGap: 4 }}>
                    {!showSearchBar && (
                        <ThemedButton
                            variant="tertiary"
                            iconName={revealHidden ? 'eye' : 'eye-invisible'}
                            iconStyle={{
                                color: revealHidden ? color.text._100 : color.text._700,
                            }}
                            onPress={handleToggleHidden}
                        />
                    )}
                    <ThemedButton
                        variant="tertiary"
                        iconName={showSearchBar ? 'backward' : 'search'}
                        onPress={() => {
                            setShowSearchBar(!showSearchBar)
                            setShowSearchResults(searchQuery.length > 0 && !showSearchBar)
                        }}
                    />
                </View>
            </View>
            <Animated.View key={showSearchBar + ''} entering={FadeIn} exiting={FadeOut}>
                {showSearchBar && (
                    <ThemedTextInput
                        placeholder="Search for message..."
                        containerStyle={{ flex: 0, marginTop: 12, marginBottom: 12 }}
                        value={searchQuery}
                        autoCorrect={false}
                        onChangeText={setSearch}
                        submitBehavior="submit"
                    />
                )}
            </Animated.View>
            {!showSearchResults && (
                <>
                    <Animated.View
                        layout={YAxisOnlyTransition}
                        entering={FadeIn.duration(200)}
                        style={styles.listContainer}>
                        <FlashList
                            keyboardShouldPersistTaps="always"
                            data={data}
                            keyExtractor={(item) => item.id.toString()}
                            renderItem={({ item, index }) => (
                                <ChatDrawerItem item={item} onLoad={handleLoadChat} />
                            )}
                            showsVerticalScrollIndicator={false}
                            removeClippedSubviews={false}
                        />
                    </Animated.View>
                    <Animated.View
                        entering={FadeIn}
                        exiting={FadeOut}
                        style={{ flexDirection: 'row', columnGap: 8 }}>
                        <ThemedButton
                            buttonStyle={{ flex: 1 }}
                            label="Start New Chat"
                            onPress={() => handleCreateChat(false)}
                        />
                        <ThemedButton
                            variant="secondary"
                            iconName="eye-invisible"
                            iconSize={20}
                            label="Ghost"
                            onPress={() => handleCreateChat(true)}
                        />
                    </Animated.View>
                </>
            )}
            {showSearchResults && (
                <Animated.View entering={FadeIn.duration(200)} style={styles.listContainer}>
                    {searchResults.length > 0 && (
                        <Text style={styles.resultCount}>Results: {searchResults.length}</Text>
                    )}
                    <FlashList
                        data={searchResults}
                        keyExtractor={(item) => item.swipeId.toString()}
                        renderItem={({ item }) => (
                            <ChatDrawerSearchItem
                                item={item}
                                onLoad={handleLoadChat}
                                query={searchQuery}
                            />
                        )}
                        showsVerticalScrollIndicator={false}
                        removeClippedSubviews={false}
                        ListEmptyComponent={() => (
                            <View style={styles.emptyContainer}>
                                <Text style={styles.emptyText}>No Results</Text>
                            </View>
                        )}
                    />
                </Animated.View>
            )}
        </Drawer.Body>
    )
}

export default ChatsDrawer

const useStyles = () => {
    const { color, spacing, fontSize } = Theme.useTheme()

    return StyleSheet.create({
        drawer: {
            backgroundColor: color.neutral._100,
            width: '90%',
            shadowColor: color.shadow,
            borderTopWidth: 3,
            elevation: 20,
            right: 0,
            position: 'absolute',
            height: '100%',
            paddingHorizontal: spacing.xl,
            paddingTop: spacing.xl,
            paddingBottom: spacing.xl2,
        },

        drawerTitle: {
            color: color.text._300,
            fontSize: fontSize.xl,
            paddingLeft: spacing.s,
        },

        title: {
            color: color.text._100,
            fontSize: fontSize.l,
        },

        emptyText: {
            color: color.text._400,
            fontSize: fontSize.m,
            fontStyle: 'italic',
        },

        emptyContainer: {
            flex: 1,
            alignItems: 'center',
            padding: spacing.xl3,
        },

        resultCount: {
            color: color.text._600,
            fontSize: fontSize.s,
            marginBottom: spacing.m,
        },

        listContainer: {
            flex: 1,
            marginTop: spacing.m,
            marginBottom: spacing.l,
        },
    })
}
