-- Extra Meta Ads metrics per (platform, date, campaign), stored as raw counts so
-- the dashboard can derive frequency/CTR/CPM/CPC/cost-per-LPV over any window by
-- summing across days/campaigns (deriving on raw sums avoids averaging averages).
--
--   reach              unique people reached (Meta 'reach')
--   link_clicks        clicks on the link (Meta 'inline_link_clicks')
--   landing_page_views landing page views (Meta actions[].landing_page_view)
--
-- impressions and spend_cents already live in ad_spend (0013). frequency is
-- derived (impressions / reach), not stored. NOTE: reach is a de-duplicated
-- count, so summing daily reach over a window slightly overestimates true reach
-- — acceptable for an internal operator dashboard.
ALTER TABLE ad_spend ADD COLUMN reach INTEGER DEFAULT 0;
ALTER TABLE ad_spend ADD COLUMN link_clicks INTEGER DEFAULT 0;
ALTER TABLE ad_spend ADD COLUMN landing_page_views INTEGER DEFAULT 0;
