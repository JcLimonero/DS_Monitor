import { Injectable, computed, signal } from '@angular/core';
import {
  Account,
  AccountColor,
  LicenseProvider,
  ManualLicense,
  ManualLicensePeriod,
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
  period: ManualLicensePeriod;
  renewsAt?: string;
  url?: string;
  notes?: string;
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

  /**
   * Vacía cuentas y modos (ya viven en el servidor); deja las licencias. Con
   * `conservar`, se queda solo con eso (lo que no se pudo subir).
   */
  clearAccountSettings(
    conservar?: Pick<
      LocalSettings,
      'accounts' | 'accountEnabled' | 'removedAccounts' | 'connectionMode'
    >
  ): void {
    this.commit({
      ...this.settingsSignal(),
      accounts: conservar?.accounts ?? [],
      accountEnabled: conservar?.accountEnabled ?? {},
      removedAccounts: conservar?.removedAccounts ?? [],
      connectionMode: conservar?.connectionMode ?? {}
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

  addManualLicense(input: NewManualLicense): ManualLicense {
    const now = new Date();
    const renewsAt =
      input.renewsAt ||
      new Date(
        now.getTime() + (input.period === 'anual' ? 366 : 31) * 86_400_000
      ).toISOString();
    const license: ManualLicense = {
      id: `manual-${crypto.randomUUID()}`,
      provider: input.provider,
      product: input.product.trim(),
      plan:
        input.plan?.trim() ||
        (input.period === 'anual'
          ? 'Anual'
          : input.period === 'mensual'
            ? 'Mensual'
            : undefined),
      unit: 'dinero',
      used: input.cost ?? 0,
      periodStart: now.toISOString(),
      periodEnd: renewsAt,
      cost: input.cost,
      currency: input.currency,
      renewsAt,
      manual: true,
      period: input.period,
      notes: input.notes?.trim() || undefined,
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

  /** Deja vacías las licencias de este navegador, ya subidas al puente. */
  clearLocalLicenses(): void {
    this.commit({
      ...this.settingsSignal(),
      licenseEdits: {},
      manualLicenses: []
    });
  }

  /**
   * Quita de este navegador lo que ya subió al puente y deja solo lo que no se
   * pudo subir (`quedan`), para que no se pierda.
   */
  conservarSoloLicencias(
    quedan: readonly { id: string; tipo: 'manual' | 'ajuste' }[]
  ): void {
    const manuales = new Set(
      quedan.filter((q) => q.tipo === 'manual').map((q) => q.id)
    );
    const ajustes = new Set(
      quedan.filter((q) => q.tipo === 'ajuste').map((q) => q.id)
    );
    const current = this.settingsSignal();
    this.commit({
      ...current,
      // Con un id repetido solo se conserva el ultimo (el que el puente descarto).
      manualLicenses: current.manualLicenses.filter(
        (l, i, todas) =>
          manuales.has(l.id) &&
          todas.map((otra) => otra.id).lastIndexOf(l.id) === i
      ),
      licenseEdits: Object.fromEntries(
        Object.entries(current.licenseEdits).filter(([id]) => ajustes.has(id))
      )
    });
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
