import { HttpClient } from '@angular/common/http';
import {
  EnvironmentProviders,
  inject,
  makeEnvironmentProviders
} from '@angular/core';
import { PortalConfig, SourceConnection } from '../config/portal-config.model';
import {
  DemoCalendarSource,
  DemoCrmSource,
  DemoDeploymentSource,
  DemoLicenseSource,
  DemoMonitorSource,
  DemoRepoSource,
  DemoTaskSource
} from './demo/demo.sources';
import {
  GatewayCalendarSource,
  GatewayCrmSource,
  GatewayDeploymentSource,
  GatewayLicenseSource,
  GatewayMonitorSource,
  GatewayRepoSource,
  GatewayTaskSource
} from './gateway/gateway.sources';
import { LocalTaskStore } from './local/local-task.store';
import {
  CALENDAR_SOURCES,
  CRM_SOURCES,
  CalendarSource,
  CrmSource,
  DEPLOYMENT_SOURCES,
  DeploymentSource,
  LICENSE_SOURCES,
  LicenseSource,
  MONITOR_SOURCES,
  MonitorSource,
  REPO_SOURCES,
  RepoSource,
  TASK_SOURCES,
  TaskSource
} from './source.contracts';

/**
 * Traduce la configuración a adaptadores vivos.
 *
 * Es el único lugar donde se decide si una conexión corre en demo o contra el
 * puente. Ni las vistas ni el almacén se enteran de la diferencia.
 */

/** Conexiones habilitadas que ofrecen cierta capacidad. */
function connectionsFor(
  config: PortalConfig,
  capability: SourceConnection['provides'][number]
): SourceConnection[] {
  const enabled = new Set(
    config.accounts.filter((account) => account.enabled).map((a) => a.id)
  );
  return config.connections.filter(
    (connection) =>
      connection.provides.includes(capability) &&
      enabled.has(connection.accountId)
  );
}

function labelOf(config: PortalConfig, connection: SourceConnection): string {
  return (
    config.accounts.find((account) => account.id === connection.accountId)
      ?.label ?? connection.id
  );
}

/**
 * Una conexión corre contra el puente solo si así se pidio y además hay una
 * raíz a donde pegarle. Sin `gatewayUrl` cae a demo en vez de fallar en cada
 * petición, que es lo útil mientras el puente no existe.
 */
function useGateway(
  config: PortalConfig,
  connection: SourceConnection
): boolean {
  return (
    connection.mode === 'gateway' && !!config.gatewayUrl && !!connection.path
  );
}

function buildTaskSources(
  config: PortalConfig,
  http: HttpClient,
  local: LocalTaskStore
): TaskSource[] {
  return connectionsFor(config, 'tasks').map((connection) => {
    const label = labelOf(config, connection);
    if (connection.kind === 'local') {
      return local;
    }
    return useGateway(config, connection)
      ? new GatewayTaskSource(
          connection.id,
          label,
          connection.kind,
          http,
          config.gatewayUrl,
          connection.path!
        )
      : new DemoTaskSource(
          connection.id,
          label,
          connection.kind,
          connection.accountId
        );
  });
}

function buildCalendarSources(
  config: PortalConfig,
  http: HttpClient
): CalendarSource[] {
  return connectionsFor(config, 'meetings').map((connection) => {
    const label = labelOf(config, connection);
    return useGateway(config, connection)
      ? new GatewayCalendarSource(
          connection.id,
          label,
          connection.kind,
          http,
          config.gatewayUrl,
          connection.path!
        )
      : new DemoCalendarSource(
          connection.id,
          label,
          connection.kind,
          connection.accountId
        );
  });
}

function buildMonitorSources(
  config: PortalConfig,
  http: HttpClient
): MonitorSource[] {
  return connectionsFor(config, 'monitors').map((connection) => {
    const label = labelOf(config, connection);
    return useGateway(config, connection)
      ? new GatewayMonitorSource(
          connection.id,
          label,
          http,
          config.gatewayUrl,
          connection.path!
        )
      : new DemoMonitorSource(connection.id, label, connection.accountId);
  });
}

function buildCrmSources(config: PortalConfig, http: HttpClient): CrmSource[] {
  return connectionsFor(config, 'crm').map((connection) => {
    const label = labelOf(config, connection);
    return useGateway(config, connection)
      ? new GatewayCrmSource(
          connection.id,
          label,
          http,
          config.gatewayUrl,
          connection.path!
        )
      : new DemoCrmSource(connection.id, label, connection.accountId);
  });
}

function buildLicenseSources(
  config: PortalConfig,
  http: HttpClient
): LicenseSource[] {
  return connectionsFor(config, 'licenses').map((connection) => {
    const label = labelOf(config, connection);
    return useGateway(config, connection)
      ? new GatewayLicenseSource(
          connection.id,
          label,
          connection.kind,
          http,
          config.gatewayUrl,
          connection.path!
        )
      : new DemoLicenseSource(
          connection.id,
          label,
          connection.kind,
          connection.accountId
        );
  });
}

function buildDeploymentSources(
  config: PortalConfig,
  http: HttpClient
): DeploymentSource[] {
  return connectionsFor(config, 'deployments').map((connection) => {
    const label = labelOf(config, connection);
    return useGateway(config, connection)
      ? new GatewayDeploymentSource(
          connection.id,
          label,
          http,
          config.gatewayUrl,
          connection.path!
        )
      : new DemoDeploymentSource(connection.id, label, connection.accountId);
  });
}

function buildRepoSources(
  config: PortalConfig,
  http: HttpClient
): RepoSource[] {
  return connectionsFor(config, 'repos').map((connection) => {
    const label = labelOf(config, connection);
    return useGateway(config, connection)
      ? new GatewayRepoSource(
          connection.id,
          label,
          http,
          config.gatewayUrl,
          connection.path!
        )
      : new DemoRepoSource(connection.id, label, connection.accountId);
  });
}

export function providePortalSources(
  config: PortalConfig
): EnvironmentProviders {
  return makeEnvironmentProviders([
    {
      provide: TASK_SOURCES,
      useFactory: () =>
        buildTaskSources(config, inject(HttpClient), inject(LocalTaskStore))
    },
    {
      provide: CALENDAR_SOURCES,
      useFactory: () => buildCalendarSources(config, inject(HttpClient))
    },
    {
      provide: MONITOR_SOURCES,
      useFactory: () => buildMonitorSources(config, inject(HttpClient))
    },
    {
      provide: CRM_SOURCES,
      useFactory: () => buildCrmSources(config, inject(HttpClient))
    },
    {
      provide: LICENSE_SOURCES,
      useFactory: () => buildLicenseSources(config, inject(HttpClient))
    },
    {
      provide: DEPLOYMENT_SOURCES,
      useFactory: () => buildDeploymentSources(config, inject(HttpClient))
    },
    {
      provide: REPO_SOURCES,
      useFactory: () => buildRepoSources(config, inject(HttpClient))
    }
  ]);
}
