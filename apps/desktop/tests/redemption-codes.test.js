/**
 * RedemptionCodes unit tests
 */
// Note: crypto.randomBytes is NOT mocked to ensure unique codes in batch generation
// The generate function uses crypto.randomBytes directly

describe("RedemptionCodes", function() {
  var RedemptionCodes

  beforeAll(function() {
    RedemptionCodes = require("../electron/services/redemption-codes")
  })

  test("generates a valid code", function() {
    var code = RedemptionCodes.generate()
    expect(code).toBeDefined()
    expect(typeof code).toBe("string")
    expect(code.split("-").length).toBe(4)
  })

  test("generated code passes validation", function() {
    var code = RedemptionCodes.generate()
    var result = RedemptionCodes.validate(code)
    expect(result.valid).toBe(true)
  })

  test("validate returns invalid for random string", function() {
    var result = RedemptionCodes.validate("INVALID-CODE-HERE-1234")
    expect(result.valid).toBe(false)
  })

  test("validate returns invalid for tampered code", function() {
    var code = RedemptionCodes.generate()
    var tampered = code.slice(0, -1) + String.fromCharCode(code.charCodeAt(code.length - 1) ^ 1)
    var result = RedemptionCodes.validate(tampered)
    expect(result.valid).toBe(false)
  })

  test("generateBatch creates multiple unique codes", function() {
    var codes = RedemptionCodes.generateBatch(5)
    expect(Array.isArray(codes)).toBe(true)
    expect(codes.length).toBe(5)
    var unique = new Set(codes)
    expect(unique.size).toBe(5)
  })

  test("code with metadata validates successfully", function() {
    var code = RedemptionCodes.generate({ plan: "pro", duration: "lifetime" })
    var result = RedemptionCodes.validate(code)
    expect(result.valid).toBe(true)
  })

  test("code with metadata parameters is still valid", function() {
    // Metadata is embedded as signature, doesn't affect validity
    var code = RedemptionCodes.generate({ plan: "pro" })
    var result = RedemptionCodes.validate(code)
    expect(result.valid).toBe(true)
  })

  test("code format validation rejects wrong format", function() {
    expect(RedemptionCodes.validate("").valid).toBe(false)
    expect(RedemptionCodes.validate("SHORT").valid).toBe(false)
    expect(RedemptionCodes.validate("AAAA-BBBB-CCCC").valid).toBe(false)
    expect(RedemptionCodes.validate(12345).valid).toBe(false)
  })
})
