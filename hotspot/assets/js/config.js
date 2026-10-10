//this is to enable multi vendo setup, set to true when multi vendo is supported
var isMultiVendo = true;
// 0 = traditional (client choose a vendo) , 1 = auto select vendo base on hotspot address, 2 = interface name ( this will preserve one hotspot server ip only)
var multiVendoOption = 0;

//list here all node mcu address for multi vendo setup
var multiVendoAddresses = [
	{
		vendoName: "TEST1",
		vendoIp: "10.0.0.243",
		chargingEnable: false,
		eloadEnable: false
	}
];


//0 means its login by username only, 1 = means if login by username + password
var loginOption = 0; //replace 1 if you want login voucher by username + password

var dataRateOption = false; //replace true if you enable data rates
//put here the default selected address
var vendorIpAddress = "10.0.0.243";

var chargingEnable = false; //replace true if you enable charging, this can be override if multivendo setup

var eloadEnable = false; //replace true if you enable eload, this can be override if multivendo setup

//hide pause time / logout true = you want to show pause / logout button
var showPauseTime = true;

//enable member login, true = if you want to enable member login
var showMemberLogin = true;

//enable extend time button for customers
var showExtendTimeButton = true;

//disable voucher input
var disableVoucherInput = false;

//enable mac address as voucher code
var macAsVoucherCode = true;

var qrCodeVoucherPurchase = false;

// JuanFi centralized roaming session token support.
var controllerApiUrl = "http://10.0.0.243:3000/api";
var sessionCookieName = "juanfi_sid";
