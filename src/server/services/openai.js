const OpenAI = require('openai');

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

/**
 * Use AI to select the best 10 videos from a candidate list based on user criteria.
 * Returns an array of video IDs.
 */
async function curateVideos(candidates, userCriteria, rejectedVideos) {
  if (candidates.length <= 10) {
    return candidates.map(v => v.videoId);
  }

  const candidateList = candidates.map((v, i) => (
    `${i + 1}. [${v.videoId}] "${v.title}" by ${v.channelTitle} — ${v.description || '(no description)'}`
  )).join('\n');

  const rejectionContext = rejectedVideos.length > 0
    ? `\n\nThe user has previously rejected these types of videos:\n${rejectedVideos.map(r => `- "${r.video_id}"${r.rejection_reason ? `: ${r.rejection_reason}` : ''}`).join('\n')}\n\nAvoid recommending similar content.`
    : '';

  const prompt = `You are a YouTube video curator. Your job is to select exactly 10 videos from the candidate list below that best match the user's preferences.

USER'S CURATION CRITERIA:
${userCriteria}
${rejectionContext}

CANDIDATE VIDEOS:
${candidateList}

Select the 10 best videos that match the user's criteria. Return ONLY a JSON array of exactly 10 video IDs, like this:
["videoId1", "videoId2", ..., "videoId10"]

If there are fewer than 10 good matches, still return exactly 10 — pick the best available. Return ONLY the JSON array, no other text.`;

  try {
    const response = await client.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.7,
      max_tokens: 500,
    });

    const content = response.choices[0].message.content.trim();
    // Extract JSON array from response
    const match = content.match(/\[[\s\S]*\]/);
    if (!match) {
      console.error('OpenAI did not return a valid JSON array:', content);
      return candidates.slice(0, 10).map(v => v.videoId);
    }

    const ids = JSON.parse(match[0]);
    // Validate that returned IDs are in our candidate list
    const candidateIds = new Set(candidates.map(v => v.videoId));
    const validIds = ids.filter(id => candidateIds.has(id));

    if (validIds.length < 10) {
      // Pad with remaining candidates
      const used = new Set(validIds);
      for (const v of candidates) {
        if (validIds.length >= 10) break;
        if (!used.has(v.videoId)) {
          validIds.push(v.videoId);
          used.add(v.videoId);
        }
      }
    }

    return validIds.slice(0, 10);
  } catch (err) {
    console.error('OpenAI curation error:', err.message);
    // Fallback: return first 10 candidates
    return candidates.slice(0, 10).map(v => v.videoId);
  }
}

/**
 * Given a rejection, suggest an update to the user's curation criteria.
 */
async function suggestCriteriaUpdate(currentCriteria, rejectedVideoTitle, rejectionReason) {
  try {
    const response = await client.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [{
        role: 'user',
        content: `A user has these video curation preferences:
"${currentCriteria}"

They just rejected a video titled "${rejectedVideoTitle}"${rejectionReason ? ` with reason: "${rejectionReason}"` : ''}.

Rewrite the curation criteria to incorporate this feedback. Keep it concise (2-3 sentences max). Return ONLY the updated criteria text, nothing else.`
      }],
      temperature: 0.5,
      max_tokens: 200,
    });

    return response.choices[0].message.content.trim();
  } catch (err) {
    console.error('OpenAI criteria update error:', err.message);
    return currentCriteria; // Return unchanged on error
  }
}

module.exports = { curateVideos, suggestCriteriaUpdate };
