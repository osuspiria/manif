-- Phase 5: lookups by link token, and the public list (most recently confirmed first).
CREATE INDEX idx_sig_token ON signatures(confirm_token_hash);
CREATE INDEX idx_sig_public ON signatures(kind, is_public, status, confirmed_at);
