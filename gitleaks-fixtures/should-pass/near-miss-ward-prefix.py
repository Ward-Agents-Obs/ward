# Fixture: legacy `ward_<48 hex>` archived seed-key format (#27 standardized
# on `ak_live_<32 hex>`). The current `ward-api-key` rule's regex is
# `ak_live_[0-9a-f]{32}`, so this should NOT trigger — but if someone widens
# the rule to "ward.*" without thinking, the F1 historical leaks would re-fire
# on all surviving documentation references and this fixture catches that.
LEGACY_KEY_REFERENCE = "ward_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
