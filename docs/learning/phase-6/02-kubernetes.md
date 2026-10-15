# Run the real application with Helm and kind

This exercise moves the existing images from Compose into a local Kubernetes cluster. It does not provision EKS or replace the costed AWS Compose deployment. The chart is deliberately a single-node learning topology: two or three API processes share one database, broker and local application volume.

## Run it

Prerequisites are the normal project's Node/Docker/FFmpeg setup, a generated fixture and enough spare memory/disk for a local Kubernetes node plus the app. This 16 GiB workstation also runs the normal app, so allow several GiB for the exercise. The tool helper supports Linux amd64 and downloads pinned official binaries with verified SHA-256 hashes into ignored `.local/tools/kubernetes`.

```sh
npm run fixture
PEERSCREEN_BUILD_NETWORK=host npm run kube -- up
npm run kube -- status
```

Open `http://localhost:3400`. This is a separate local environment with its own generated credentials and volumes. Sign up there, create a channel and upload your own MP4. Your normal app stays at port 3000 and its Google credentials/data are not copied into the cluster. The exercise does not configure Google for the second localhost port.

`npm run test:kubernetes` creates a different, disposable `peerscreen-exercise` cluster. It uses the same chart, generates a three-second 720p source, exercises upload/processing/publication, checks 480p/720p manifests and shared sessions through two replicas, then scales API to three. It records ready Service endpoints and distinct responding replicas. It deletes only the cluster it created, including on failure, and retains private diagnostics under `.local/kubernetes/exercise`. Stop an interactive port-3400 lab before running that disposable exercise.

## Map the objects to concepts

| Object              | PeerScreen use                                             | Why it exists                                                                                |
| ------------------- | ---------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| Deployment          | API, coordinator, worker, web, gateway and Redis processes | Maintains desired replicas and replaces exited containers                                    |
| StatefulSet         | PostgreSQL and Kafka                                       | Stable pod identities for the stateful services in this small topology                       |
| Service             | Internal database/RPC/web addresses                        | Stable discovery while individual pod addresses change                                       |
| Headless Service    | `api`                                                      | Gives Envoy DNS discovery all API addresses instead of hiding replicas behind one virtual IP |
| NodePort            | Gateway port 30080                                         | The kind node maps it to host loopback port 3400                                             |
| ConfigMap           | Non-secret URLs, paths and gateway/bootstrap files         | Configuration can change independently of a compiled binary                                  |
| Secret              | Per-role database/RPC/Redis configuration                  | Keeps credential values out of the chart and container images                                |
| PVC                 | Database, broker and shared media/upload directories       | Data survives normal pod replacement on this node                                            |
| Job                 | Schema migrations, topic setup and fixture initialization  | Bounded setup completes before application processes serve work                              |
| PodDisruptionBudget | At least one API during voluntary disruptions              | Expresses an availability constraint; it cannot create another host                          |

Helm renders Go **templates** into Kubernetes YAML; those templates are not the compiled Go backend. For example, `replicas: {{ .Values.apiReplicas }}` reads `apiReplicas` from `values.yaml`. The chart's JSON schema constrains it to one through four. A template `range` emits similar API/coordinator/worker resources with different commands and role Secrets. `helm template` shows the rendered documents; `helm lint` checks the chart; the actual cluster then validates and runs them. A Helm release revision identifies a deployment update and is separate from a media job's lease epoch.

Kubernetes Secrets are base64-encoded API objects, not an automatic encrypted vault. The private kubeconfig grants local cluster administration. Do not commit either the kubeconfig or generated secret manifest. App pods do not mount Kubernetes API tokens. Catalogue/coordinator/worker get only their own role configuration; they do not all receive the PostgreSQL administrator password.

## Startup is a dependency sequence

Compose's `depends_on` does not exist in Kubernetes. The bootstrap Job waits for actual PostgreSQL readiness, initializes storage, applies catalogue/media migrations, creates the Kafka topics and seeds the isolated fixture. It writes a release-specific ready marker only after those steps succeed. Application init containers wait for that marker before starting. A Helm upgrade gets a new revision and a new setup Job/marker; the new app pods do not mistake an older migration marker for the current release's completion.

The web image also checks for a fixture at startup. Compose mounts its media volume; Kubernetes must mount the same logical directory too. Omitting that volume caused a real startup failure during implementation. Likewise, importing registry-pinned dependency images through Docker's archive format caused a containerd alias/checkpoint lookup problem on this tool combination. The helper now imports only locally built application images; the node pulls dependency images using their original pinned registry digests.

Kubernetes normally injects service-address environment variables into pods. A generated `MEDIA_PORT=tcp://...` collided with the frontend's numeric port setting. The chart explicitly disables service links and uses ConfigMap values and DNS names. Its single combined Kafka broker/controller uses loopback for its own controller connection; that internal connection must not depend on a Service becoming ready first.

There are bounded retries and a Job deadline. Failures remain failed: the helper records diagnostics and does not replace migrations or processing with success-shaped placeholder output.

## Readiness, liveness and resources

The API's startup/liveness endpoint answers whether its HTTP process is alive. Its readiness endpoint checks whether it can serve application work. A failed readiness probe removes that pod from ready Service endpoints; a failed liveness probe can restart a process. Using a dependency outage as liveness would restart healthy applications unnecessarily. Envoy also checks individual API readiness before routing.

The coordinator uses its existing authenticated Go healthcheck. The worker's probe only establishes that its main process exists; job progress/leases remain owned by the coordinator rather than inferred from a process check. PostgreSQL readiness and Kafka startup probes gate the actual service endpoints. These are not complete broker/database monitoring exporters.

Resource requests inform scheduling; limits bound the container's CPU/memory use. They do not reserve an extra physical machine. The application containers run without privilege escalation and drop Linux capabilities. Writable media/scratch directories are mounted explicitly; application root filesystems are read-only. Shared filesystem storage is appropriate here because all pods run on one node. It is not a multi-node RWX storage solution.

## Scale and inspect it yourself

For the interactive lab, use the workspace tools and its explicit private context:

```sh
.local/tools/kubernetes/kubectl --kubeconfig .local/kubernetes/local/kubeconfig --context kind-peerscreen-local -n peerscreen get pods
.local/tools/kubernetes/kubectl --kubeconfig .local/kubernetes/local/kubeconfig --context kind-peerscreen-local -n peerscreen scale deployment api --replicas=3
.local/tools/kubernetes/kubectl --kubeconfig .local/kubernetes/local/kubeconfig --context kind-peerscreen-local -n peerscreen rollout status deployment/api
.local/tools/kubernetes/kubectl --kubeconfig .local/kubernetes/local/kubeconfig --context kind-peerscreen-local -n peerscreen get endpointslices -l kubernetes.io/service-name=api
```

Compare desired replicas, ready pods and ready endpoints. Envoy then refreshes DNS and applies its own readiness checks. The exercise waits for the third responding replica rather than assuming EndpointSlice readiness means the gateway has already discovered it. They are related but different observations. Open a signed-in page again: its session survives because every API reads the same PostgreSQL session records. Scaling API does not scale FFmpeg workers, PostgreSQL or Kafka. A later Helm upgrade restores the replica count specified in values; an imperative scale command does not change the chart's saved configuration.

When finished, `npm run kube -- down` deletes the interactive lab cluster and its lab data. It does not stop or erase the normal Compose app. Export any lab data you want first. This exercise is intentionally disposable; the verified production backup/restore procedure is a different workflow.

Sources: [kind quick start](https://kind.sigs.k8s.io/docs/user/quick-start/), [Helm quick start](https://helm.sh/docs/intro/quickstart/), [Kubernetes probes](https://kubernetes.io/docs/tasks/configure-pod-container/configure-liveness-readiness-startup-probes/), [kind 0.33.0 release](https://github.com/kubernetes-sigs/kind/releases/tag/v0.33.0), [Helm 4.3.0 release](https://github.com/helm/helm/releases/tag/v4.3.0). Version and checksum checks were made on 15 October 2026 IST.
