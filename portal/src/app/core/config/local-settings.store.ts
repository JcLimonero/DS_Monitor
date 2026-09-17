import { Injectable, computed, signal } from '@angular/core';
import {
  Account,
  AccountColor,
  LicenseProvider,
  LicenseUsage,
  SourceKind
} from '../models';
import {
  LicenseEdit,
  LocalSettings,
  accountIdFor,
  readLocalSettings,
  writeLocalSettings
} from './local-settings';

/** Lo que pide el formulario de alta de un buzón. */
export interface NewMailAccount {
  label: string;
  email: string;
  kind: SourceKind;
  color: AccountColor;
}

/** Lo que pide el formulario de alta de una licencia a mano. */
export interface NewManualLicense {
  product: string;
  provider: LicenseProvider;
  accountId: string;
  plan?: string;
  cost?: number;
  currency: string;
  period: 'mensual' | 'anual';
  renewsAt?: string;
  url?: string;
}

/**
 * Los ajustes locales como señales, para que las vistas reaccionen.
 *
 * Las ediciones de licencias se ven al instante. Agregar o apagar una cuenta
 * requiere recargar, porque los adaptadores se construyen al arrancar a
 * partir de la configuración; quien llama decide cuándo recargar.
 */
@Injectable({ providedIn: 'root' })
export class LocalSettingsStore {
  private readonly settingsSignal = signal<LocalSettings>(readLocalSettings());

  readonly settings = this.settingsSignal.asReadonly();
  readonly licenseEdits = computed(() => this.settingsSignal().licenseEdits);
  readonly manualLicenses = computed(
    () => this.settingsSignal().manualLicenses
  );
  readonly addedAccounts = computed(() => this.settingsSignal().accounts);

  isAdded(accountId: string): boolean {
    return this.settingsSignal().accounts.some((a) => a.id === accountId);
  }

  addMailAccount(input: NewMailAccount, taken: ReadonlySet<string>): Account {
    const account: Account = {
      id: accountIdFor(input.label, taken),
      label: input.label.trim(),
      detail: `${input.email.trim()} · ${describeKind(input.kind)}`,
      kind: input.kind,
      color: input.color,
      enabled: true
    };
    this.commit({
      ...this.settingsSignal(),
      accounts: [...this.settingsSignal().accounts, account]
    });
    return account;
  }

  /** Quita una cuenta: si es de fábrica queda marcada como borrada. */
  removeAccount(accountId: string): void {
    const current = this.settingsSignal();
    const { [accountId]: _enabled, ...accountEnabled } = current.accountEnabled;
    const agregada = current.accounts.some((a) => a.id === accountId);
    this.commit({
      ...current,
      accounts: current.accounts.filter((a) => a.id !== accountId),
      removedAccounts: agregada
        ? current.removedAccounts
        : [...new Set([...current.removedAccounts, accountId])],
      accountEnabled
    });
  }

  setConnectionMode(connectionId: string, mode: 'demo' | 'gateway'): void {
    const current = this.settingsSignal();
    this.commit({
      ...current,
      connectionMode: { ...current.connectionMode, [connectionId]: mode }
    });
  }

  setAccountEnabled(accountId: string, enabled: boolean): void {
    const current = this.settingsSignal();
    this.commit({
      ...current,
      accountEnabled: { ...current.accountEnabled, [accountId]: enabled }
    });
  }

  editLicense(licenseId: string, edit: LicenseEdit): void {
    const current = this.settingsSignal();
    const merged = { ...current.licenseEdits[licenseId], ...edit };
    // Un campo vacío es "quitar la corrección", no "poner vacío".
    const cleaned = Object.fromEntries(
      Object.entries(merged).filter(
        ([, value]) => value !== undefined && value !== '' && value !== false
      )
    ) as LicenseEdit;
    const licenseEdits = { ...current.licenseEdits };
    if (Object.keys(cleaned).length === 0) {
      delete licenseEdits[licenseId];
    } else {
      licenseEdits[licenseId] = cleaned;
    }
    this.commit({ ...current, licenseEdits });
  }

  clearLicenseEdit(licenseId: string): void {
    const current = this.settingsSignal();
    const { [licenseId]: _edit, ...licenseEdits } = current.licenseEdits;
    this.commit({ ...current, licenseEdits });
  }

  addManualLicense(input: NewManualLicense): LicenseUsage {
    const now = new Date();
    const renewsAt =
      input.renewsAt ||
      new Date(
        now.getTime() + (input.period === 'anual' ? 366 : 31) * 86_400_000
      ).toISOString();
    const license: LicenseUsage = {
      id: `manual-${crypto.randomUUID()}`,
      provider: input.provider,
      product: input.product.trim(),
      plan:
        input.plan?.trim() || (input.period === 'anual' ? 'Anual' : 'Mensual'),
      unit: 'dinero',
      used: input.cost ?? 0,
      periodStart: now.toISOString(),
      periodEnd: renewsAt,
      cost: input.cost,
      currency: input.currency,
      renewsAt,
      manual: true,
      members: [],
      accountId: input.accountId,
      url: input.url?.trim() || undefined,
      updatedAt: now.toISOString()
    };
    this.commit({
      ...this.settingsSignal(),
      manualLicenses: [...this.settingsSignal().manualLicenses, license]
    });
    return license;
  }

  removeManualLicense(licenseId: string): void {
    const current = this.settingsSignal();
    this.commit({
      ...current,
      manualLicenses: current.manualLicenses.filter((l) => l.id !== licenseId)
    });
  }

  private commit(settings: LocalSettings): void {
    this.settingsSignal.set(settings);
    writeLocalSettings(settings);
  }
}

function describeKind(kind: SourceKind): string {
  switch (kind) {
    case 'google':
      return 'Google';
    case 'microsoft':
      return 'Microsoft 365';
    case 'imap':
      return 'IMAP';
    default:
      return kind;
  }
}

/**
 * Las licencias que llegaron de las fuentes, con las correcciones encima, sin
 * las ocultas, y con las capturadas a mano al final.
 */
export function applyLicenseSettings(
  fetched: readonly LicenseUsage[],
  settings: LocalSettings
): LicenseUsage[] {
  const edited = fetched
    .filter((license) => !settings.licenseEdits[license.id]?.hidden)
    .map((license) => {
      const edit = settings.licenseEdits[license.id];
      if (!edit) {
        return license;
      }
      const { hidden: _hidden, ...fields } = edit;
      const corrected = { ...license, ...fields };
      // Cuando la unidad es dinero, lo consumido del periodo es el costo.
      return corrected.unit === 'dinero' && fields.cost !== undefined
        ? { ...corrected, used: fields.cost }
        : corrected;
    });
  return [...edited, ...settings.manualLicenses];
}
