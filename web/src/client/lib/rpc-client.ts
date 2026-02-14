import { hc } from "hono/client";
import type { AppType } from "../../../server-app";

const client = hc<AppType>("");

export const sessionsApi = client.api.sessions;
export const authApi = client.api.auth;
export const settingsApi = client.api.settings;
