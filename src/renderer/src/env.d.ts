import type { VuApi } from "@shared/api";

declare global {
    interface Window {
        vu: VuApi;
    }
}
