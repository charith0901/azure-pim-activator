import * as vscode from "vscode";
import { ActivationRecord, Profile } from "../core/types";

const PROFILES_KEY = "pim.profiles";
const ACTIVATIONS_KEY = "pim.activations";

type ActivationMap = Record<string, ActivationRecord>;

function key(name: string): string {
  return name.trim().toLowerCase();
}

/** Persists profiles and their last-known activation in globalState. */
export class ProfileStore implements vscode.Disposable {
  private readonly emitter = new vscode.EventEmitter<void>();
  readonly onDidChange: vscode.Event<void> = this.emitter.event;

  constructor(private readonly state: vscode.Memento) {}

  private readProfiles(): Profile[] {
    const v = this.state.get<Profile[]>(PROFILES_KEY);
    return Array.isArray(v) ? v : [];
  }

  private readActivations(): ActivationMap {
    const v = this.state.get<ActivationMap>(ACTIVATIONS_KEY);
    return v && typeof v === "object" ? v : {};
  }

  list(): Profile[] {
    return [...this.readProfiles()].sort((a, b) => {
      const la = a.lastUsedAt ?? "";
      const lb = b.lastUsedAt ?? "";
      if (la !== lb) return la < lb ? 1 : -1;
      return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
    });
  }

  get(name: string): Profile | undefined {
    const k = key(name);
    return this.readProfiles().find((p) => key(p.name) === k);
  }

  async save(p: Omit<Profile, "createdAt"> & { createdAt?: string }): Promise<Profile> {
    const profiles = this.readProfiles();
    const k = key(p.name);
    const idx = profiles.findIndex((x) => key(x.name) === k);
    const existing = idx >= 0 ? profiles[idx] : undefined;
    const saved: Profile = {
      ...p,
      createdAt: existing?.createdAt ?? p.createdAt ?? new Date().toISOString(),
    };
    if (idx >= 0) profiles[idx] = saved;
    else profiles.push(saved);
    await this.state.update(PROFILES_KEY, profiles);
    this.emitter.fire();
    return saved;
  }

  async delete(name: string): Promise<boolean> {
    const k = key(name);
    const profiles = this.readProfiles();
    const remaining = profiles.filter((p) => key(p.name) !== k);
    const activations = this.readActivations();
    const hadActivation = k in activations;
    if (remaining.length === profiles.length && !hadActivation) return false;
    await this.state.update(PROFILES_KEY, remaining);
    if (hadActivation) {
      delete activations[k];
      await this.state.update(ACTIVATIONS_KEY, activations);
    }
    this.emitter.fire();
    return remaining.length !== profiles.length;
  }

  async touch(name: string): Promise<void> {
    const k = key(name);
    const profiles = this.readProfiles();
    const p = profiles.find((x) => key(x.name) === k);
    if (!p) return;
    p.lastUsedAt = new Date().toISOString();
    await this.state.update(PROFILES_KEY, profiles);
    this.emitter.fire();
  }

  getActivation(name: string): ActivationRecord | undefined {
    return this.readActivations()[key(name)];
  }

  async setActivation(name: string, rec: ActivationRecord | undefined): Promise<void> {
    const activations = this.readActivations();
    const k = key(name);
    if (rec) activations[k] = rec;
    else delete activations[k];
    await this.state.update(ACTIVATIONS_KEY, activations);
    this.emitter.fire();
  }

  isActive(name: string): boolean {
    const end = this.getActivation(name)?.endDateTime;
    if (!end) return false;
    const t = Date.parse(end);
    return !Number.isNaN(t) && t > Date.now();
  }

  dispose(): void {
    this.emitter.dispose();
  }
}
