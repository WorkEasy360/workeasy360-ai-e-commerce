-- The worker replaces an order's review link if one exists (insert … on conflict update).
GRANT UPDATE (token_hash, expires_at) ON app.review_requests TO wec_worker;
