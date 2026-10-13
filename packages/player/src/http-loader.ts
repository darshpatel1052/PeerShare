import Hls, {
  type LoaderContext,
  type LoaderConfiguration,
  type LoaderCallbacks,
} from "hls.js";

type Validator = (
  url: string,
  range: { start: number; end: number } | undefined,
  data: ArrayBuffer,
) => Promise<boolean>;

export function verifiedHttpLoader(
  validate: Validator,
  onCompleted: (bytes: number) => void,
) {
  return class VerifiedHttpLoader extends Hls.DefaultConfig.loader {
    private active = true;
    load(
      context: LoaderContext,
      config: LoaderConfiguration,
      callbacks: LoaderCallbacks<LoaderContext>,
    ) {
      this.active = true;
      if (!("frag" in context)) {
        super.load(context, config, callbacks);
        return;
      }
      super.load(context, config, {
        ...callbacks,
        // Bytes must not enter the transmuxer before complete-object validation.
        onProgress: undefined,
        onSuccess: async (response, stats, loadedContext, details) => {
          const range =
            context.rangeStart !== undefined &&
            context.rangeEnd !== undefined &&
            context.rangeEnd > context.rangeStart
              ? { start: context.rangeStart, end: context.rangeEnd - 1 }
              : undefined;
          const valid =
            response.data instanceof ArrayBuffer &&
            (await validate(context.url, range, response.data));
          if (!this.active) return;
          if (!valid) {
            callbacks.onError(
              { code: 0, text: "Segment integrity verification failed" },
              loadedContext,
              details,
              stats,
            );
            return;
          }
          onCompleted((response.data as ArrayBuffer).byteLength);
          callbacks.onSuccess(response, stats, loadedContext, details);
        },
      });
    }
    abort() {
      this.active = false;
      super.abort();
    }
    destroy() {
      this.active = false;
      super.destroy();
    }
  };
}
