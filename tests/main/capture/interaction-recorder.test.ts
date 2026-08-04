import { describe, expect, it, vi } from "vitest";
import { InteractionRecorder } from "../../../src/main/capture/interaction-recorder";

describe("InteractionRecorder", () => {
  it("waits for hook injection before enabling recording", async () => {
    let resolveInjection: (() => void) | undefined;
    const injection = new Promise<void>((resolve) => {
      resolveInjection = resolve;
    });
    const executeJavaScript = vi
      .fn()
      .mockImplementationOnce(() => injection)
      .mockResolvedValue(undefined);
    const webContents = {
      isDestroyed: () => false,
      executeJavaScript,
      once: vi.fn(),
      on: vi.fn(),
      removeListener: vi.fn(),
    };
    const recorder = new InteractionRecorder({} as never);
    recorder.start("session-1", {} as never);
    (recorder as unknown as { scriptContent: string }).scriptContent = "interaction-hook";

    const attaching = recorder.injectIntoWebContents(webContents as never);

    expect(executeJavaScript).toHaveBeenCalledTimes(1);
    expect(executeJavaScript).toHaveBeenNthCalledWith(1, "interaction-hook", true);

    resolveInjection?.();
    await attaching;

    expect(executeJavaScript).toHaveBeenCalledTimes(2);
    expect(executeJavaScript).toHaveBeenNthCalledWith(
      2,
      "window.postMessage({type:'ar-interaction-control',recording:true},'*')",
      true,
    );
    expect(webContents.on).toHaveBeenCalledWith("did-finish-load", expect.any(Function));
  });
});
