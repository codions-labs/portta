/** A private loopback forward that an exposure provider may publish under a
 *  named HTTP URL (for example a reverse-proxy route). */
export interface EndpointExposureRequest {
  endpointId: string
  projectId: string
  environmentId: string
  workspaceId: string
  serviceName: string
  /** The loopback forward the published URL must reach, e.g. `http://127.0.0.1:49152`. */
  targetUrl: string
}

export interface PublishedEndpoint {
  url: string
}

/** Publishes and revokes named HTTP URLs for loopback forwards. Taskflow owns
 *  the forwards; the provider only owns the names in front of them, so an HTTP
 *  endpoint without a published name keeps reporting its forward URL. */
export interface EndpointExposureProvider {
  /** Recorded as the endpoint's `provider`, so its routes can be revoked later. */
  readonly kind: string
  /** `null` when this provider publishes nothing for the request. */
  publish(request: EndpointExposureRequest): Promise<PublishedEndpoint | null>
  revoke(endpoint: { endpointId: string; projectId: string }): Promise<void>
}

/** The default: no names are published and HTTP endpoints stay on their loopback forward. */
export const disabledEndpointExposure: EndpointExposureProvider = {
  kind: 'disabled',
  publish: async (): Promise<null> => null,
  revoke: async (): Promise<void> => {},
}
