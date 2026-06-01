import * as admin from 'firebase-admin';
import {FCMToken} from '../models/FCMToken';
if (!admin.apps.length) {
    admin.initializeApp({
        credential: admin.credential.cert(
            JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON!)
        ),
    });
}
export async function sendPushToUser(
    userId: string,
    title: string,
    body: string,
    data?: Record<string, string>
): Promise<void> {
    const tokens = await FCMToken.find({userId}).select('token').lean();
    if (tokens.length === 0) return;
    const message: admin.messaging.MulticastMessage = {
        tokens: tokens.map((t) => t.token),
        notification: {title, body},
        data: data ?? {},
        android: {
            priority: 'high',
            notification: {
                channelId: 'minlish_reminders',
                sound: 'default',
            },
        },
    };
    const result = await admin.messaging().sendEachForMulticast(message);
    const invalidTokens: string[] = [];
    result.responses.forEach((resp, idx) => {
        if (
            !resp.success && resp.error?.code === 'messaging/registration-token-not-registered'
        ){
            invalidTokens.push(tokens[idx].token);
        }
    });
    if (invalidTokens.length > 0){
        await FCMToken.deleteMany({token: {$in: invalidTokens}});
        console.log(`[Push] Da xoa ${invalidTokens.length} token het han`);
    }
}