const { App } = require('@slack/bolt');
const fs = require('fs').promises;
const path = require('path');
require('dotenv').config();
// Debug logging toggle
const isDebugEnabled =
  (process.env.LOG_LEVEL || '').toLowerCase() === 'debug' ||
  process.env.DEBUG === '1' ||
  (process.env.DEBUG || '').toLowerCase() === 'true';
const debugLog = (...args) => {
  if (isDebugEnabled) {
    // eslint-disable-next-line no-console
    console.log('[debug]', ...args);
  }
};
// Initializes your app with credentials
const app = new App({
  token: process.env.SLACK_BOT_TOKEN,
  signingSecret: process.env.SLACK_SIGNING_SECRET,
  socketMode: true, // enable to use socket mode
  appToken: process.env.APP_TOKEN,
});
debugLog('Slack Bolt App initialized', {
  socketMode: true,
  hasBotToken: Boolean(process.env.SLACK_BOT_TOKEN),
  hasSigningSecret: Boolean(process.env.SLACK_SIGNING_SECRET),
  hasAppToken: Boolean(process.env.APP_TOKEN),
});

app.event('member_joined_channel', async ({ event, client, logger }) => {
  try {
    debugLog('member_joined_channel received', {
      channel: event.channel,
      user: event.user,
      channel_type: event.channel_type,
    });
    if (event.channel !== 'C097R32FC15' && event.channel !== 'C08SKC6P85V')
      // Not a tracked channel
      debugLog('Ignoring join event for channel', event.channel);
    debugLog('Prompting user for referrer', { user: event.user });
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
    debugLog('Prompt message sent to user', { user: event.user });
  } catch (error) {
    logger.error(error);
  }
});

// Helper functions for managing referrals data
async function loadReferralsData() {
  try {
    const filePath = 'referals/referals.json';
    debugLog('Loading referrals data from', filePath);
    const data = await fs.readFile(filePath, 'utf8');
    const parsed = JSON.parse(data);
    debugLog('Referrals data loaded', {
      selections: Object.keys(parsed.selections || {}).length,
      referrals: Object.keys(parsed.referrals || {}).length,
    });
    return parsed;
  } catch (error) {
    // If file doesn't exist or is empty, return default structure
    debugLog('Referrals data not found or invalid. Using defaults.', {
      error: error?.message,
    });
    return {
      selections: {}, // tracks who selected whom
      referrals: {}, // tracks who referred whom (detailed relationships)
    };
  }
}

async function saveReferralsData(data) {
  // Ensure directory exists
  const dir = 'referals';
  const filePath = path.join(dir, 'referals.json');
  await fs.mkdir(dir, { recursive: true });
  debugLog('Saving referrals data', {
    selections: Object.keys(data.selections || {}).length,
    referrals: Object.keys(data.referrals || {}).length,
    filePath,
  });
  await fs.writeFile(filePath, JSON.stringify(data, null, 2));
  debugLog('Referrals data saved');
}

// Helper function to get referral counts
function getReferralCounts(referralsData) {
  const counts = {};
  Object.values(referralsData.referrals).forEach((referrerId) => {
    counts[referrerId] = (counts[referrerId] || 0) + 1;
  });
  debugLog('Computed referral counts', {
    uniqueReferrers: Object.keys(counts).length,
  });
  return counts;
}

// Helper function to generate leaderboard
async function generateLeaderboard(client, referralsData) {
  const counts = getReferralCounts(referralsData);
  const sorted = Object.entries(counts)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 10);
  debugLog('Generating leaderboard', { topN: sorted.length });

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
  debugLog('Action received: siege-invite-select');
  await ack();
  debugLog('Action acked: siege-invite-select');

  try {
    const selectedUserId = body.actions[0].selected_user;
    const selectorUserId = body.user.id;
    debugLog('Referral selection received', {
      selectorUserId,
    });

    // Load current referrals data
    const referralsData = await loadReferralsData();

    // Check if user has already selected someone
    if (referralsData.selections[selectorUserId]) {
      const previousReferrer = referralsData.selections[selectorUserId];
      debugLog('Updating existing selection', {
        selectorUserId,
        previousReferrer,
        newReferrer: selectedUserId,
      });

      // Remove from previous referrer's count
      if (referralsData.referrals[selectorUserId]) {
        delete referralsData.referrals[selectorUserId];
      }

      // Update selection
      referralsData.selections[selectorUserId] = selectedUserId;
      referralsData.referrals[selectorUserId] = selectedUserId;

      // Save the updated data
      await saveReferralsData(referralsData);
      debugLog('Selection updated and saved', { selectorUserId });

      await client.chat.postMessage({
        channel: selectorUserId,
        mrkdwn: true,
        text: `You successfully updated your referrer from <@${previousReferrer}> to <@${selectedUserId}>!`,
      });
      debugLog('Update confirmation sent', { selectorUserId });
      return;
    }

    // Record the selection
    referralsData.selections[selectorUserId] = selectedUserId;
    referralsData.referrals[selectorUserId] = selectedUserId;
    debugLog('Recorded new selection', { selectorUserId, selectedUserId });

    // Save the updated data
    await saveReferralsData(referralsData);
    debugLog('New selection saved', { selectorUserId });

    await client.chat.postMessage({
      channel: selectorUserId,
      mrkdwn: true,
      text: `Thanks for selecting <@${selectedUserId}> as your referrer. \n\nWelcome to a new YSWS about shipping every week. Ship every week for 3 months and get a framework! Before the main event starts, we're running a referral campaign. If you can refer at least 5 people, you'll get a special prize + you get coins for each referral! \n\nYou can refer people by sending them a link to <#C08SKC6P85V|#siege>`,
    });
    debugLog('Selection confirmation sent', { selectorUserId });
  } catch (error) {
    logger.error(error);
  }
});

// Handle direct messages for leaderboard
app.event('message', async ({ event, client, logger, say }) => {
  try {
    // Only respond to direct messages (IM)
    if (event.channel_type === 'im' && event.subtype !== 'bot_message') {
      debugLog('Direct message received', {
        user: event.user,
        text: event.text,
      });
      const referralsData = await loadReferralsData();
      const leaderboardText = await generateLeaderboard(client, referralsData);
      debugLog('Leaderboard generated for DM');

      say(leaderboardText);

      if (
        event.user === 'U07BN55GN3D' &&
        typeof event.text === 'string' &&
        /^set\s+<@([A-Z0-9]+)>\s+to\s+<@([A-Z0-9]+)>$/i.test(event.text.trim())
      ) {
        const match = event.text
          .trim()
          .match(/^set\s+<@([A-Z0-9]+)>\s+to\s+<@([A-Z0-9]+)>$/i);
        if (match) {
          const xUserId = match[1];
          const yUserId = match[2];
          debugLog('Admin override parsed', { xUserId, yUserId });
          referralsData.selections[xUserId] = yUserId;
          referralsData.referrals[xUserId] = yUserId;
          await saveReferralsData(referralsData);
          debugLog('Admin override saved', { xUserId, yUserId });
          await client.chat.postMessage({
            channel: event.user,
            text: `Set <@${xUserId}>'s referrer to <@${yUserId}>.`,
          });
          debugLog('Admin confirmation sent');
        }
        return;
      }
    }
  } catch (error) {
    logger.error(error);
  }
});

(async () => {
  const port = 3000;
  await app.start(process.env.PORT || port);
  console.log('Bolt app started!!');
  debugLog('App start complete', { port: process.env.PORT || port });
})();
