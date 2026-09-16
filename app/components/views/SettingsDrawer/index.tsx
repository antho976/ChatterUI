import { useState } from 'react'
import { Text, TouchableOpacity } from 'react-native'
import { useMMKVBoolean } from 'react-native-mmkv'

import Drawer from '@components/views/Drawer'
import { AppSettings } from '@lib/constants/GlobalValues'
import { Logger } from '@lib/state/Logger'
import { Theme } from '@lib/theme/ThemeManager'
import appConfig from 'app.config'

import AppModeToggle from './AppModeToggle'
import RouteList from './RouteList'
import UserInfo from './UserInfo'

const SettingsDrawer = () => {
    const { color, spacing } = Theme.useTheme()
    const [devMode, setDevMode] = useMMKVBoolean(AppSettings.DevMode)
    const [tapCount, setTapCount] = useState(0)

    // tapping the version 7 times toggles dev mode (previously on the About page)
    const handleVersionTap = () => {
        const next = tapCount + 1
        if (next >= 7) {
            setTapCount(0)
            setDevMode(!devMode)
            Logger.infoToast(`Dev mode ${devMode ? 'disabled' : 'enabled'}`)
            return
        }
        setTapCount(next)
    }

    return (
        <Drawer.Body
            drawerID={Drawer.ID.SETTINGS}
            drawerStyle={{
                width: '60%',
                paddingBottom: spacing.xl,
            }}>
            <UserInfo />
            <AppModeToggle />
            <RouteList />
            <TouchableOpacity
                activeOpacity={0.8}
                onPress={handleVersionTap}
                style={{ alignSelf: 'center', marginTop: spacing.l, marginBottom: spacing.xl2 }}>
                <Text style={{ color: color.text._300 }}>
                    {__DEV__ && 'DEV BUILD\t'}
                    {devMode && 'DEV MODE\t'}
                    {'v' + appConfig.expo.version}
                </Text>
            </TouchableOpacity>
        </Drawer.Body>
    )
}

export default SettingsDrawer
