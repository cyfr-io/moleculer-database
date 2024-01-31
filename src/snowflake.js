function hexToDec(hexStr) {
	if (hexStr.substring(0, 2) === '0x') hexStr = hexStr.substring(2);
	hexStr = hexStr.toLowerCase();
	return convertBase(hexStr, 16, 10);
}

function convertBase(str, fromBase, toBase) {
	const digits = parseToDigitsArray(str, fromBase);
	if (digits === null) return null;

	let outArray = [];
	let power = [1];
	for (let i = 0; i < digits.length; i++) {
		if (digits[i]) {
			outArray = add(outArray, multiplyByNumber(digits[i], power, toBase), toBase);
		}
		power = multiplyByNumber(fromBase, power, toBase);
	}

	let out = '';
	for (let i = outArray.length - 1; i >= 0; i--) {
		out += outArray[i].toString(toBase);
	}
	return out;
}

function parseToDigitsArray(str, base) {
	const digits = str.split('');
	const ary = [];
	for (let i = digits.length - 1; i >= 0; i--) {
		const n = parseInt(digits[i], base);
		if (isNaN(n)) return null;
		ary.push(n);
	}
	return ary;
}

function add(x, y, base) {
	const z = [];
	const n = Math.max(x.length, y.length);
	let carry = 0;
	let i = 0;
	while (i < n || carry) {
		const xi = i < x.length ? x[i] : 0;
		const yi = i < y.length ? y[i] : 0;
		const zi = carry + xi + yi;
		z.push(zi % base);
		carry = Math.floor(zi / base);
		i++;
	}
	return z;
}

function multiplyByNumber(num, x, base) {
	if (num < 0) return null;
	if (num == 0) return [];

	let result = [];
	let power = x;
	while (true) {
		if (num & 1) {
			result = add(result, power, base);
		}
		num = num >> 1;
		if (num === 0) break;
		power = add(power, power, base);
	}

	return result;
}

function Snowflake(options) {
	options = options || {};
	this.seq = 0;
	this.rnd = Math.floor(Math.random() * 1023); // Random Machine ID, up to 10 bits
	this.offset = options.offset || 0;
	this.lastTime = 0;
	this.instanceId = options.instanceId || Snowflake.generateRandomId(4); // Less precise instanceId, 6 digits
	this.instanceId = this.instanceId.padStart(32, '0');

	const instanceNumber = (parseInt(hexToDec(this.instanceId)) % 24) + 1000;
	this.instanceNumber = instanceNumber.toString(2).padStart(5, '0');
}

// Method to generate random numeric IDQ
Snowflake.generateRandomId = function (length) {
	let result = '';
	for (let i = 0; i < length; i++) {
		result += Math.floor(Math.random() * 10).toString();
	}
	return result;
};

Snowflake.prototype.generate = function () {
	const epoch = 1119484800000;
	let time = Date.now() - epoch;
	let bTime = (time - this.offset).toString(2);

	// Get the sequence number
	if (this.lastTime == time) {
		this.seq++;

		if (this.seq > 4095) {
			this.seq = 0;
			time++; // Increment time by 1 millisecond
			bTime = (time - this.offset).toString(2); // Recalculate bTime
		}
	} else {
		this.seq = 0;
	}

	this.lastTime = time;

	let bSeq = this.seq.toString(2);
	let bRnd = this.rnd.toString(2);

	// Create sequence binary bit
	while (bSeq.length < 12) bSeq = '0' + bSeq;
	while (bRnd.length < 10) bRnd = '0' + bRnd; // Corrected variable name from bMid to bRnd

	const bid = bTime + this.instanceNumber + bSeq + bRnd;
	let id = '';

	for (let i = bid.length; i > 0; i -= 4) {
		id = parseInt(bid.substring(i - 4, i), 2).toString(16) + id;
	}

	return hexToDec(id).padStart(23, '0').substring(0, 23);
};

module.exports = Snowflake;
