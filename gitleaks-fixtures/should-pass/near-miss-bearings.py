# Fixture: substrings containing "bear" but NOT the bearer-token keyword.
# The `bearer-token-literal` regex requires the literal `bearer` word followed
# by `[\s_:=]+`, so unrelated identifiers shouldn't trip it. If someone
# loosens the keyword check to a substring match, every `bearings` in robotics
# code or `forbearance` in legal docs would false-positive — caught here.
BEARINGS = ["NTN-6203-2RS-deepgroovebearingfixture", "SKF-6204Z-fixture-token"]
FORBEARANCE_NOTICE = "loan-forbearance-policy-fixture-2026"
