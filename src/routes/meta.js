import { Router } from 'express';
import { wrap } from '../lib/http.js';
import { taxonomy, ruleFields } from '../domain/taxonomy.js';
import { WEIGHTS } from '../domain/matching.js';
import * as regions from '../services/regions.js';
import { PRODUCTS, PREMIUM_BENEFITS } from '../services/billing.js';
import { SAFETY_TIPS } from '../domain/safety.js';
import { config } from '../config.js';

export const metaRouter = Router();

/** Toàn bộ lựa chọn có thể chọn trong app — client dựng form từ đây. */
metaRouter.get(
  '/taxonomy',
  wrap((req, res) =>
    res.json({
      taxonomy,
      rule_fields: ruleFields,
      matching_weights: WEIGHTS,
      limits: {
        max_radius_free_km: config.matching.maxRadiusFreeKm,
        max_radius_premium_km: config.matching.maxRadiusPremiumKm,
        free_daily_likes: config.matching.freeDailyLikes,
        daily_picks: config.matching.dailyPicks,
      },
      products: PRODUCTS,
      premium_benefits: PREMIUM_BENEFITS,
      safety_tips: SAFETY_TIPS,
    })
  )
);

/* --------------------------------------------------------------- khu vực */

metaRouter.get(
  '/regions',
  wrap((req, res) => {
    const parent = req.query.parent_id ? Number(req.query.parent_id) : null;
    if (req.query.q) {
      return res.json({ regions: regions.searchRegions(String(req.query.q)) });
    }
    // Không có parent_id → trả về danh sách tỉnh/thành (bỏ qua cấp quốc gia).
    if (parent == null) {
      const country = regions.listChildren(null)[0];
      return res.json({
        regions: country ? regions.listChildren(country.id) : [],
        level: 'province',
      });
    }
    res.json({ regions: regions.listChildren(parent) });
  })
);

metaRouter.get(
  '/regions/:id/path',
  wrap((req, res) => res.json({ path: regions.regionPath(Number(req.params.id)) }))
);

metaRouter.get(
  '/regions/open',
  wrap((req, res) =>
    res.json({
      provinces: regions.openProvinces().map((p) => ({ id: p.id, name: p.name })),
      note: 'Vigo Match mở đăng ký theo từng khu vực để đảm bảo mật độ người dùng đủ dày.',
    })
  )
);

metaRouter.get('/health', (req, res) =>
  res.json({ ok: true, service: 'vigo-match', time: new Date().toISOString() })
);
