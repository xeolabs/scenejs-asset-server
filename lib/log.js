/*-----------------------------------------------
 logging:
 -----------------------------------------------*/

var sys = require("sys");

var months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function pad(n) {
    return n < 10 ? '0' + n.toString(10) : n.toString(10);
}

function timestamp() {
    var d = new Date();
    return [
        d.getDate(),
        months[d.getMonth()],
        [ pad(d.getHours())
            , pad(d.getMinutes())
            , pad(d.getSeconds())
            , (d.getTime() + "").substr(- 4, 4)
        ].join(':')
    ].join(' ');
}

exports.log = function(msg) {
    sys.puts(timestamp() + ' - ' + msg.toString());
};