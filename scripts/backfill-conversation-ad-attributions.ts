// scripts/backfill-conversation-ad-attributions.ts
// node --env-file=.env.local --import tsx scripts/backfill-conversation-ad-attributions.ts <Meta ad IDs...>
import { backfillConversationAdAttributions } from "../lib/zernio/conversationAdAttribution";

const adIds = [...new Set(process.argv.slice(2))];
if (!adIds.length || adIds.length > 50 || adIds.some(id => !/^\d{5,30}$/.test(id))) {
    throw new Error("Provide 1–50 explicit numeric Meta ad IDs to refresh.");
}
void backfillConversationAdAttributions(adIds).then(result => {
    console.log(JSON.stringify(result));
    if (result.failed_ads > 0) process.exitCode = 1;
}).catch(error => { console.error(error); process.exitCode = 1; });
