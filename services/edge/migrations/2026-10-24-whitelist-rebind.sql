-- Whitelist rebind (改绑): a user whose X handle changed after their
-- application was approved can submit a NEW handle that supersedes the
-- approved one. Approving the rebind request swaps the whitelist spot in a
-- single admin action: the new handle is upserted (existing approve flow)
-- and the superseded handle is retired from the published whitelist.
ALTER TABLE whitelist_requests ADD COLUMN supersedes_handle TEXT;
