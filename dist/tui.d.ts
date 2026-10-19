import { Plugin } from '@opencode/plugin/tui';

interface JarvisActions {
    toggle(): Promise<void>;
    enable(): Promise<void>;
    disable(): Promise<void>;
    status(): Promise<void>;
}
declare function jarvisCommands(actions: JarvisActions): {
    id: string;
    title: string;
    description: string;
    group: string;
    palette: true;
    slash: {
        name: string;
    };
    run: () => Promise<void>;
}[];
declare function setupJarvisTui(context: Plugin.Context): Promise<() => Promise<void>>;
declare const _default: Plugin.Definition;

export { _default as default, jarvisCommands, setupJarvisTui };
