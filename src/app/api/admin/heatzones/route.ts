import { NextResponse } from 'next/server';
import { getFirebaseAdminApp, readAdminRtdb, verifyAdminRequest } from '@/lib/server/firebaseAdmin';

export const runtime = 'nodejs';

export async function GET(req: Request) {
  const app = getFirebaseAdminApp();
  const admin = await verifyAdminRequest(req, app);
  if (!admin) return NextResponse.json({ ok: false, reason: 'unauthorized' }, { status: 401 });

  try {
    const data = (await readAdminRtdb<Record<string, any>>('heatzones', app, admin.idToken)) || {};

    // ── Page views aggregation ──
    const pageViewCounts: Record<string, number> = {};
    const pageFromMap: Record<string, Record<string, number>> = {};  // page → { fromPage: count }
    const pageViewSnaps = data.pageViews || {};

    for (const [key, records] of Object.entries(pageViewSnaps) as [string, Record<string, any>][]) {
      const pageLabel = key.split('_')[0] || 'Unknown';
      pageFromMap[pageLabel] = pageFromMap[pageLabel] || {};
      for (const record of Object.values(records)) {
        pageViewCounts[pageLabel] = (pageViewCounts[pageLabel] ?? 0) + 1;
        const from = record.fromPage || 'Direct';
        pageFromMap[pageLabel][from] = (pageFromMap[pageLabel][from] ?? 0) + 1;
      }
    }

    // Sort pages by view count
    const pageLeaderboard = Object.entries(pageViewCounts)
      .map(([pageId, views]) => ({ pageId, views }))
      .sort((a, b) => b.views - a.views);

    // Build per-page heatmap data (from-jumps)
    const pageHeatmaps = pageLeaderboard.map(({ pageId, views }) => {
      const fromEntries = pageFromMap[pageId] || {};
      const jumps = Object.entries(fromEntries)
        .map(([from, count]) => ({ from, count, pct: views ? Math.round((count / views) * 100) : 0 }))
        .sort((a, b) => b.count - a.count);
      return { pageId, views, jumps };
    });

    // ── Feature clicks aggregation ──
    const featureCounts: Record<string, Record<string, number>> = {}; // pageId → { featureId: count }
    const featureClickSnaps = data.featureClicks || {};

    for (const [key, records] of Object.entries(featureClickSnaps) as [string, Record<string, any>][]) {
      const pageLabel = key.split('_')[0] || 'Unknown';
      featureCounts[pageLabel] = featureCounts[pageLabel] || {};
      for (const record of Object.values(records)) {
        const fid = record.featureId || 'Unknown';
        featureCounts[pageLabel][fid] = (featureCounts[pageLabel][fid] ?? 0) + 1;
      }
    }

    // Build feature leaderboard per page
    const featureLeaderboard: Record<string, Array<{ featureId: string; clicks: number }>> = {};
    for (const [pageId, feats] of Object.entries(featureCounts)) {
      featureLeaderboard[pageId] = Object.entries(feats)
        .map(([featureId, clicks]) => ({ featureId, clicks }))
        .sort((a, b) => b.clicks - a.clicks);
    }

    // Total unique pages and features
    const totalPageViews = Object.values(pageViewCounts).reduce((s, v) => s + v, 0);
    const totalFeatureClicks = Object.values(featureCounts).reduce((s, feats) => s + Object.values(feats).reduce((a, b) => a + b, 0), 0);

    return NextResponse.json({
      ok: true,
      fetchedAt: Date.now(),
      totals: {
        pageViews: totalPageViews,
        featureClicks: totalFeatureClicks,
        uniquePages: pageLeaderboard.length,
      },
      pageLeaderboard,
      pageHeatmaps,
      featureLeaderboard,
    });
  } catch (error: any) {
    return NextResponse.json({ ok: false, reason: error?.message || 'Internal error' }, { status: 500 });
  }
}
