# Haolo Chrome plugin

This built-in Codex plugin routes Chrome tasks to the Haolo desktop-managed `chrome` MCP server. The MCP process never connects to Chrome directly: it calls a token-authenticated loopback bridge, which applies site policy and CapabilityGrant checks before the Native Host and MV3 extension execute a closed tool.

The companion browser extension remains a separate Chrome Web Store package and must be authorized per site by the user.
