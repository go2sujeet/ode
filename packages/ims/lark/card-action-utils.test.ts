import { describe, expect, it } from "bun:test";
import {
  extractFormValues,
  firstNonEmptyString,
  pickActionSelectedOption,
  pickFormValue,
  pickValueField,
} from "@/ims/lark/utils/card-action-utils";

describe("lark card action utilities", () => {
  it("extracts non-empty values and value fields", () => {
    expect(firstNonEmptyString("", "  ", "value ")).toBe("value");
    expect(pickValueField({ channel_id: "C1" }, "channel_id")).toBe("C1");
    expect(pickValueField({ channelId: "C2" }, "channel_id")).toBe("C2");
  });

  it("extracts selected option from action payload", () => {
    const payload = { event: { action: { option: { value: "codex" } } } };
    expect(pickActionSelectedOption(payload)).toBe("codex");
  });

  it("extracts form values and supports existence checks", () => {
    const payload = {
      event: {
        action: {
          form_value: {
            provider: { option: { value: "opencode" } },
            model: "gpt-5",
          },
        },
      },
    };
    const values = extractFormValues(payload);
    expect(values.provider).toBe("opencode");
    expect(values.model).toBe("gpt-5");
    expect(pickFormValue(values, "provider")).toEqual({ exists: true, value: "opencode" });
    expect(pickFormValue(values, "missing")).toEqual({ exists: false, value: "" });
  });
});
