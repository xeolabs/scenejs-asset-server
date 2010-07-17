exports.checkParams = function(params, expected, er, ok) {
    for (var i = 0; i < expected.length; i++) {
        if (!params[expected[i]]) {
            er({ error: 501, body: expected[i] + " expected" });
            return;
        }
    }
    ok();
}
