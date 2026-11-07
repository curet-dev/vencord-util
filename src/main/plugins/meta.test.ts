import { describe, expect, it } from "vitest";
import { parsePluginMeta } from "./meta";

describe("parsePluginMeta", () => {
    it("reads name, description and authors", () => {
        const source = `
            export default definePlugin({
                name: "Cool Plugin",
                description: 'Does "cool" things',
                authors: [Devs.Ven, EquicordDevs.Someone, { name: "Custom Author", id: 1n }],
                start() {}
            });`;
        expect(parsePluginMeta(source)).toEqual({
            isPlugin: true,
            name: "Cool Plugin",
            description: 'Does "cool" things',
            authors: ["Ven", "Someone", "Custom Author"]
        });
    });

    it("ignores files without definePlugin", () => {
        expect(parsePluginMeta("export const util = 1;")).toEqual({ isPlugin: false, authors: [] });
    });

    it("tolerates names that are not string literals", () => {
        expect(parsePluginMeta("definePlugin({ name: PLUGIN_NAME })")).toMatchObject({ isPlugin: true, name: undefined });
    });
});
