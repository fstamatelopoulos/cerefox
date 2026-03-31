-- Migration 0010: Seed requestor enforcement config defaults
--
-- Adds two new config keys for optional requestor identity enforcement
-- on MCP tool calls. Both default to "off" for backward compatibility.

INSERT INTO cerefox_config (key, value)
VALUES ('require_requestor_identity', 'false')
ON CONFLICT (key) DO NOTHING;

INSERT INTO cerefox_config (key, value)
VALUES ('requestor_identity_format', '^[a-zA-Z0-9_:.\- ]+$')
ON CONFLICT (key) DO NOTHING;
