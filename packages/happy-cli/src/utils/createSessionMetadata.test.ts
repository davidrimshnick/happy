import { describe, expect, it } from 'vitest';
import type { SandboxConfig } from '@/persistence';
import { createSessionMetadata } from './createSessionMetadata';

function createSandboxConfig(overrides: Partial<SandboxConfig> = {}): SandboxConfig {
    return {
        enabled: true,
        workspaceRoot: '~/Developer',
        sessionIsolation: 'workspace',
        customWritePaths: [],
        denyReadPaths: ['~/.ssh', '~/.aws', '~/.gnupg'],
        extraWritePaths: ['/tmp'],
        denyWritePaths: ['.env'],
        networkMode: 'allowed',
        allowedDomains: [],
        deniedDomains: [],
        allowLocalBinding: true,
        ...overrides,
    };
}

describe('createSessionMetadata', () => {
    it('sets metadata.sandbox to the config when enabled', () => {
        const sandbox = createSandboxConfig();
        const { metadata } = createSessionMetadata({
            flavor: 'codex',
            machineId: 'machine-1',
            startedBy: 'terminal',
            sandbox,
        });

        expect(metadata.sandbox).toEqual(sandbox);
    });

    it('sets metadata.sandbox to null when sandbox is disabled', () => {
        const sandbox = createSandboxConfig({ enabled: false });
        const { metadata } = createSessionMetadata({
            flavor: 'gemini',
            machineId: 'machine-2',
            startedBy: 'daemon',
            sandbox,
        });

        expect(metadata.sandbox).toBeNull();
    });

    it('sets metadata.sandbox to null when sandbox is not provided', () => {
        const { metadata } = createSessionMetadata({
            flavor: 'claude',
            machineId: 'machine-3',
        });

        expect(metadata.sandbox).toBeNull();
    });

    it('sets metadata.dangerouslySkipPermissions to null when not provided', () => {
        const { metadata } = createSessionMetadata({
            flavor: 'codex',
            machineId: 'machine-4',
        });

        expect(metadata.dangerouslySkipPermissions).toBeNull();
    });

    it('sets metadata.dangerouslySkipPermissions when provided', () => {
        const { metadata } = createSessionMetadata({
            flavor: 'claude',
            machineId: 'machine-5',
            dangerouslySkipPermissions: true,
        });

        expect(metadata.dangerouslySkipPermissions).toBe(true);
    });

    it('propagates dangerouslySkipPermissions=true when sandbox is enabled (backend pattern)', () => {
        // This test verifies the pattern used by Codex/Gemini/ACP backends:
        //   dangerouslySkipPermissions: Boolean(sandboxConfig?.enabled)
        const sandboxConfig = createSandboxConfig({ enabled: true });
        const { metadata } = createSessionMetadata({
            flavor: 'codex',
            machineId: 'machine-6',
            startedBy: 'daemon',
            sandbox: sandboxConfig,
            dangerouslySkipPermissions: Boolean(sandboxConfig?.enabled),
        });

        expect(metadata.dangerouslySkipPermissions).toBe(true);
        expect(metadata.sandbox).toEqual(sandboxConfig);
    });

    it('propagates dangerouslySkipPermissions=false when sandbox is undefined (backend pattern)', () => {
        // Simulates when sandboxConfig is undefined (e.g. noSandbox flag in Codex)
        const sandboxConfig: SandboxConfig | undefined = undefined;
        const { metadata } = createSessionMetadata({
            flavor: 'codex',
            machineId: 'machine-7',
            startedBy: 'terminal',
            sandbox: sandboxConfig,
            dangerouslySkipPermissions: Boolean(sandboxConfig?.enabled),
        });

        expect(metadata.dangerouslySkipPermissions).toBe(false);
        expect(metadata.sandbox).toBeNull();
    });

    it('propagates dangerouslySkipPermissions=false when sandbox is disabled (backend pattern)', () => {
        const sandboxConfig = createSandboxConfig({ enabled: false });
        const { metadata } = createSessionMetadata({
            flavor: 'gemini',
            machineId: 'machine-8',
            startedBy: 'terminal',
            sandbox: sandboxConfig,
            dangerouslySkipPermissions: Boolean(sandboxConfig?.enabled),
        });

        expect(metadata.dangerouslySkipPermissions).toBe(false);
        expect(metadata.sandbox).toBeNull();
    });
});
