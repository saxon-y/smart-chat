export type DaemonRegistration = {
  daemonId: string;
  version: string;
  capabilities: string[];
};

export type DaemonLease = DaemonRegistration & {
  registeredAt: number;
  lastHeartbeatAt: number;
  expiresAt: number;
};

export type DaemonTask = {
  runId: string;
  requiredCapabilities: string[];
  credential: string;
};

export interface DaemonControlPlaneTransport {
  register(registration: DaemonRegistration): Promise<DaemonLease>;
  heartbeat(daemonId: string): Promise<DaemonLease>;
  claim(daemonId: string): Promise<DaemonTask | null>;
}

export interface WakeConnection {
  readonly closed: Promise<void>;
  close(): void;
}

export interface WakeConnector {
  connect(daemonId: string, onWake: () => void): Promise<WakeConnection>;
}

export type TaskCredentialClaims = {
  runId: string;
  daemonId: string;
  capabilities: string[];
  issuedAt: number;
  expiresAt: number;
};
