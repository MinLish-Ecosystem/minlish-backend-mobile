import {Types} from 'mongoose';
import {Notification} from '../models/Nofitication';
import {UserProfile} from '../models/UserProfile';
import {User} from '../models/User';
import {sendPushToUser} from './push.service';
import {sendDailyReminderEmail} from './mail.service';
type NotifType = | 'daily_reminder' | 'review_due' | 'streak_milestone' | 'achievement' | 'system';
interface DispatchOptions {
    dueCount?: number;
    newWordsLeft?: number;
    data?: Record<string, string>;
}
const DAILY_DEDUP_TYPES: NotifType[] = ['daily_reminder','review_due'];
export async function dispatch(
    userId: string,
    type: NotifType,
    title: string,
    message: string,
    opts: DispatchOptions = {}
): Promise<void> {
    if (DAILY_DEDUP_TYPES.includes(type)) {
        const todayStart = new Date();
        todayStart.setHours(0,0,0,0);
        const exists = await Notification.findOne({
            userId: new Types.ObjectId(userId),
            type,
            createdAt: { $gte: todayStart },
        }).lean();
        if (exists) return;
    }
    await Notification.create({
        userId: new Types.ObjectId(userId),
        type,
        title,
        message,
        isRead: false,
        data: opts.data,
    });
    const profile = await UserProfile.findOne({userId}).lean();
    if (!profile) return;
    if (profile.preferences.pushNotification) {
        await sendPushToUser(userId, title, message, {
            type,
            ...(opts.data ?? {}),
        }).catch((err) => console.error('[Dispatcher] Push FCM loi:', err));
    }
    if (profile.preferences.emailNotification) {
        const threeMinAgo = new Date(Date.now() - 3*60*1000);
        const isOffline = !profile.lastActiveAt || profile.lastActiveAt < threeMinAgo;
        if (isOffline && type === 'daily_reminder'){
            const user = await User.findById(userId).select('email name').lean();
            if (user) {
                await sendDailyReminderEmail(
                    user.email,
                    user.name,
                    opts.dueCount ?? 0,
                    opts.newWordsLeft ?? 0
                ).catch((err) => console.error('[Dispatcher] Email daily reminder loi:', err)
                );
            }
        }
        // TODO: Template review due email
    }
}