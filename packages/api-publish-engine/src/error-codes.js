// 统一错误码体系 (提取自参考产品 errorCode + PublishResult)
const errorCode = {
  success: 0,
  request_error: -1,
  data_error: -2,
  unknown_error: -3,
  exception: -4,
  io_error: -5,
  cancel_error: -999,
};

const errorMessages = {
  [errorCode.success]: "Success",
  [errorCode.request_error]: "Network request failed",
  [errorCode.data_error]: "Data parse failed",
  [errorCode.unknown_error]: "Unknown error",
  [errorCode.exception]: "System exception",
  [errorCode.io_error]: "File IO error",
  [errorCode.cancel_error]: "Task cancelled",
};

function getMsg(code) {
  return errorMessages[code] || "Unknown code: " + code;
}

function isSuccess(result) {
  return result && (result.code === 0 || result.success === true);
}

module.exports = { errorCode, getMsg, isSuccess };