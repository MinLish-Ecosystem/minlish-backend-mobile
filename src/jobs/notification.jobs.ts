import cron from 'node-cron';
import { UserProfile } from '../models/UserProfile';
import { LearningProgress } from '../models/LearningProgress';
import { dispatch } from '../services/notification-dispatcher.service';

export function startDailyReminderJob() {
  cron.schedule('* * * * *', async () => {
    try{
      const now = new Date();
      const currentHHmm = `${now.getHours().toString().padStart(2,'0')}:${now.getMinutes().toString().padStart(2,'0')}`;
      const profiles = await UserProfile.find({reminderTime: currentHHmm});
      if (profiles.length === 0) return;
      const todayStart = new Date();
      todayStart.setHours(0,0,0,0);
      for (const profile of profiles) {
        // Kiểm tra hôm nay đã học chưa
        const hasStudiedToday = await LearningProgress.findOne({
          userId: profile.userId,
          updatedAt: { $gte: todayStart },
        });
        if (hasStudiedToday) continue; // Đã học → không nhắc
        // Tính số từ cần ôn
        const dueCount = await LearningProgress.countDocuments({
          userId: profile.userId,
          nextReviewDate: { $lte: now },
        });
        // Tính số từ mới còn thiếu
        const todayNewLearned = await LearningProgress.countDocuments({
          userId: profile.userId,
          status: { $ne: 'new' },
          createdAt: { $gte: todayStart },
        });
        const newWordsLeft = Math.max(0, profile.dailyGoal - todayNewLearned);
        // Nếu không có gì cần làm → skip
        if (dueCount === 0 && newWordsLeft === 0) continue;
        // Gọi dispatcher — tự lo DB + Push + Email + Dedup
        await dispatch(
            profile.userId.toString(),
            'daily_reminder',
            '⏰ Đến giờ học rồi!',
            `Bạn còn ${dueCount} từ cần ôn và ${newWordsLeft} từ mới hôm nay.`,
            {
              dueCount,
              newWordsLeft,
              data: { screen: 'practice' },
            }
        );
      }
    } catch (err) {
      console.error('[Cron] Lỗi daily reminder job:', err);
    }
  });
  console.log('✅ Daily reminder cron job started (every minute)');
}


