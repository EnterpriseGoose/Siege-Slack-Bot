const { App } = require('@slack/bolt');
const fs = require('fs').promises;
const path = require('path');
require('dotenv').config();
// Initializes your app with credentials
const app = new App({
  token: process.env.SLACK_BOT_TOKEN,
  signingSecret: process.env.SLACK_SIGNING_SECRET,
  socketMode: true, // enable to use socket mode
  appToken: process.env.APP_TOKEN,
});

app.event('member_joined_channel', async ({ event, client, logger }) => {
  try {
    if (event.channel !== 'C097R32FC15' && event.channel !== 'C08SKC6P85V')
      return;
    console.log(event.user);
    await client.chat.postMessage({
      channel: event.user,
      text: 'Thanks for joining the raiding party! Who invited you here?',
      blocks: [
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `Thanks for joining <#${event.channel}|${event.channel_name}>! Who invited you here?`,
          },
        },
        {
          type: 'input',
          element: {
            type: 'users_select',
            placeholder: {
              type: 'plain_text',
              text: 'Select user',
              emoji: true,
            },
            action_id: 'siege-invite-select',
          },
          label: {
            type: 'plain_text',
            text: ' ',
            emoji: true,
          },
        },
      ],
    });
  } catch (error) {
    logger.error(error);
  }
});

// Helper functions for managing referrals data
async function loadReferralsData() {
  try {
    const data = await fs.readFile('referals/referals.json', 'utf8');
    return JSON.parse(data);
  } catch (error) {
    // If file doesn't exist or is empty, return default structure
    return {
      selections: {}, // tracks who selected whom
      referrals: {}, // tracks who referred whom (detailed relationships)
    };
  }
}

async function saveReferralsData(data) {
  // Ensure directory exists
  await fs.mkdir('referals', { recursive: true });
  await fs.writeFile('referals/referals.json', JSON.stringify(data, null, 2));
}

// Helper function to get referral counts
function getReferralCounts(referralsData) {
  const counts = {};
  Object.values(referralsData.referrals).forEach((referrerId) => {
    counts[referrerId] = (counts[referrerId] || 0) + 1;
  });
  return counts;
}

// Helper function to generate leaderboard
async function generateLeaderboard(client, referralsData) {
  const counts = getReferralCounts(referralsData);
  const sorted = Object.entries(counts)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 10);

  let leaderboardText = '*🏆 Top 10 Referrers 🏆*\n\n';

  if (sorted.length === 0) {
    leaderboardText += 'No referrals yet! Be the first to refer someone!';
  } else {
    for (let i = 0; i < sorted.length; i++) {
      const [userId, count] = sorted[i];
      const medal =
        i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `${i + 1}.`;
      leaderboardText += `${medal} <@${userId}> - ${count} referral${
        count > 1 ? 's' : ''
      }\n`;
    }
  }

  return leaderboardText;
}

app.action('siege-invite-select', async ({ ack, body, client, logger }) => {
  await ack();

  try {
    const selectedUserId = body.actions[0].selected_user;
    const selectorUserId = body.user.id;

    // Load current referrals data
    const referralsData = await loadReferralsData();

    // Check if user has already selected someone
    if (referralsData.selections[selectorUserId]) {
      const previousReferrer = referralsData.selections[selectorUserId];

      // Remove from previous referrer's count
      if (referralsData.referrals[selectorUserId]) {
        delete referralsData.referrals[selectorUserId];
      }

      // Update selection
      referralsData.selections[selectorUserId] = selectedUserId;
      referralsData.referrals[selectorUserId] = selectedUserId;

      // Save the updated data
      await saveReferralsData(referralsData);

      await client.chat.postMessage({
        channel: selectorUserId,
        mrkdwn: true,
        text: `You successfully updated your referrer from <@${previousReferrer}> to <@${selectedUserId}>!`,
      });
      return;
    }

    // Record the selection
    referralsData.selections[selectorUserId] = selectedUserId;
    referralsData.referrals[selectorUserId] = selectedUserId;

    // Save the updated data
    await saveReferralsData(referralsData);

    await client.chat.postMessage({
      channel: selectorUserId,
      mrkdwn: true,
      text: `Thanks for selecting <@${selectedUserId}> as your referrer. \n\nWelcome to a new YSWS about shipping every week. Ship every week for 3 months and get a framework! Before the main event starts, we're running a referral campaign. If you can refer at least 5 people, you'll get a special prize + you get coins for each referral! \n\nYou can refer people by sending them a link to <#C08SKC6P85V|#siege>`,
    });
  } catch (error) {
    logger.error(error);
  }
});

// Handle direct messages for leaderboard
app.event('message', async ({ event, client, logger, say }) => {
  try {
    // Only respond to direct messages (IM)
    if (event.channel_type === 'im' && event.subtype !== 'bot_message') {
      console.log('Direct message received:', event);
      const referralsData = await loadReferralsData();
      const leaderboardText = await generateLeaderboard(client, referralsData);

      say(leaderboardText);
    }
  } catch (error) {
    logger.error(error);
  }
});

(async () => {
  const port = 3000;
  await app.start(process.env.PORT || port);
  console.log('Bolt app started!!');
})();
