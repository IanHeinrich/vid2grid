import { ApiError, safeErrorText } from "../../api/http";
import { errorText } from "../../text";
import type { ApiSettings } from "../../types";
import type { ConnectionResult } from "./connectionBlock";

interface Reason {
  line: string;
  advice: string;
}

function reasonFor(error: unknown, apiKey: string): Reason {
  if (!(error instanceof ApiError)) {
    return error instanceof SyntaxError
      ? {
          line: "The server answered, but not with a list of models.",
          advice: "Check the base URL. It usually ends in /v1.",
        }
      : {
          line: "The server did not answer.",
          advice:
            "Check the base URL and that the server is running. A local server must also allow this page's origin (CORS).",
        };
  }
  if (error.status === 401 || error.status === 403) {
    return apiKey === ""
      ? { line: "The server needs an API key.", advice: "Add the key for this server." }
      : { line: "The server refused the API key.", advice: "Check the key for this server." };
  }
  if (error.status === 404) {
    return {
      line: "The server has no list of models at that address.",
      advice: "Check the base URL. It usually ends in /v1.",
    };
  }
  return {
    line: "The server answered with an error.",
    advice: "Try again in a moment, or look at the server's own log.",
  };
}

export function connectionFailure(
  api: ApiSettings,
  host: string,
  error: unknown,
): ConnectionResult {
  const { line, advice } = reasonFor(error, api.apiKey);
  const status = error instanceof ApiError && error.status > 0 ? `HTTP ${error.status}: ` : "";
  return {
    kind: "error",
    heading: "Could not connect",
    lines: [host, line],
    advice,
    detail: `${status}${safeErrorText(errorText(error), api)}`,
  };
}
