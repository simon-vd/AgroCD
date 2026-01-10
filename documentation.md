# Simon Van Dessel webstack on a Kubernetes cluster

## Introduction
This documentation provides a comprehensive overview of the Kubernetes-based infrastructure designed for this project. The primary goal of this architecture is to create a robust, scalable, and fully automated environment that bridges the gap between local development and production-grade orchestration. By using modern DevOps principles, this stack ensures that every component is reproducible, documented, and managed through code.

The infrastructure uses a selection of modern tools to handle cluster management, traffic routing, security, and continuous delivery:

*   **Kind (Kubernetes in Docker)**: This is the foundation of the setup. It allows us to run a real Kubernetes cluster inside Docker on a local computer, making it easy to build and test our environment without needing a cloud provider.
*   **Traefik**: This acts as the gateway for all incoming traffic. It directs web requests to the correct applications inside the cluster and handles load balancing to ensure everything stays responsive.
*   **Cert-Manager**: This tool manages security certificates. It automatically handles the creation and renewal of SSL certificates, ensuring that all connections to our services are encrypted and secure (HTTPS).
*   **Argo CD**: This is the deployment manager. It uses a "GitOps" approach, which means it constantly checks our code repository and automatically updates the cluster to match our configuration files.
*   **lighttpd**: A lightweight, high-performance web server designed for speed-critical environments, used to serve static assets with minimal resource consumption.
*   **NodeJS**: The backend runtime environment that executes JavaScript code, handling the core business logic and providing a scalable API for the frontend.
*   **MariaDB**: The relational database management system used for persistent data storage, ensuring that all application data is stored securely and remains highly available.
*   **Prometheus**: An open-source monitoring and alerting toolkit designed for reliability and scalability, used to collect and store metrics from the cluster and applications.



---
## Quick Start Guide

To set up the infrastructure and deploy the application, follow these steps in order:

1.  **Initialize the Kind Cluster**:
    Create the cluster and load the application images:
    ```bash
    kind delete cluster --name svd
    kind create cluster --name svd --config kind-expose.yaml
    kind load docker-image r1035222/ms2_frontend:latest r1035222/ms2_backend:latest --name svd
    ```

2.  **Install Infrastructure via Helm**:
    Update repositories and install the ingress controller, cert-manager, monitoring stack, and Argo CD:
    ```bash
    helm repo update

    helm install cert-manager jetstack/cert-manager \
      -n cert-manager --create-namespace \
      --set installCRDs=true

    helm install traefik traefik/traefik \
      -n traefik --create-namespace \
      --set ports.web.nodePort=30090 \
      --set ports.websecure.nodePort=31740 \
      --set service.type=NodePort

    helm install prometheus prometheus-community/kube-prometheus-stack \
      --namespace monitoring --create-namespace \
      --set prometheus.service.type=NodePort \
      --set prometheus

3.  **Apply Application Manifests**:
    Deploy the application components and GitOps configuration:
    ```bash
    kubectl apply -f clusterissuer.yaml
    kubectl apply -f namespace.yaml
    kubectl apply -f backend.yaml
    kubectl apply -f frontend.yaml
    kubectl apply -f database.yaml
    kubectl apply -f ingress.yaml
    kubectl apply -f argo-cd.yaml
    ```

4.  **Finalize and Access**:
    Wait for the Argo CD server to be ready and retrieve the initial admin password:
    ```bash
    kubectl -n argocd wait --for=condition=Ready pod -l app.kubernetes.io/name=argocd-server --timeout=120s

    # Retrieve Argo CD password (PowerShell)
    [System.Text.Encoding]::UTF8.GetString([System.Convert]::FromBase64String((kubectl -n argocd get secret argocd-initial-admin-secret -o jsonpath="{.data.password}")))
    ```

    *Prometheus RAM Usage Query:* `100 * (1 - (node_memory_MemAvailable_bytes / node_memory_MemTotal_bytes))`

---
## Accessing the Dashboards

Once the installation is complete, you can access the main application and management tools via the following endpoints:

| Service | Access URL | Description |
| :--- | :--- | :--- |
| **Main Application** | [https://milestone2.example.com:31740](https://milestone2.example.com:31740/) | Primary project landing page |
| **Prometheus** | [https://milestone2.example.com:30900](https://milestone2.example.com:30900) | Monitoring and metrics dashboard |
| **Argo CD** | [https://milestone2.example.com:30890](https://milestone2.example.com:30890) | GitOps synchronization and delivery |

---

### 📈 Prometheus
Prometheus is the monitoring and alerting toolkit used to collect and store metrics from your applications and infrastructure. It provides a powerful query language (PromQL) to visualize time-series data, helping you monitor the health and performance of your cluster.

![Prometheus Dashboard](./prom.png)

### 🐙 Argo CD
Argo CD is the GitOps tool used to maintain the desired state of your applications. It monitors your Git repositories for changes and automatically synchronizes them with the cluster. The dashboard provides a visual representation of application health, resource trees, and synchronization history.

![Argo CD Dashboard](./argocd.png)

---

## 1. Kind Cluster Configuration (`kind-expose.yaml`)
The foundation of the setup is a Kind cluster that maps specific ports from your local machine into the Kubernetes control plane.

```yaml
kind: Cluster
apiVersion: kind.x-k8s.io/v1alpha4
nodes:
  - role: control-plane
    extraPortMappings:
      - containerPort: 30090
        hostPort: 30090
      - containerPort: 30900 # Prometheus
        hostPort: 30900
      - containerPort: 31740 # HTTPS
        hostPort: 31740
      - containerPort: 30890 # ArgoCD
        hostPort: 30890
  - role: worker
  - role: worker
```

### Line-by-line explanation:
**Cluster Basics**
- `kind: Cluster` - Defines that this file is a Kind cluster configuration.
- `apiVersion: kind.x-k8s.io/v1alpha4` - Specifies the Kind configuration API version.
- `nodes:` - List of nodes to be created in the cluster.

**Control Plane & Port Mapping**
- `- role: control-plane` - Defines the first node as the control plane.
- `extraPortMappings:` - Opens ports on the Docker container running the node to the host (Windows).
- `- containerPort: 30090 / hostPort: 30090` - Maps port 30090 (used by Traefik HTTP) to your machine.
- `- containerPort: 30900 / hostPort: 30900` - Maps port 30900 (Prometheus metrics) to your machine.
- `- containerPort: 31740 / hostPort: 31740` - Maps port 31740 (used by Traefik HTTPS/TLS) to your machine.
- `- containerPort: 30890 / hostPort: 30890` - Maps port 30890 (Argo CD UI) to your machine.

**Worker Nodes**
- `- role: worker` - Adds a worker node to the cluster for scaling and distribution. Having multiple workers allows for testing high availability and pod distribution.

---

## 2. Namespace Definition (`namespace.yaml`)
Used to create a logical isolation for all our application resources.

```yaml
apiVersion: v1
kind: Namespace
metadata:
  name: svd
```

### Line-by-line explanation:
- `apiVersion: v1` - Uses the core Kubernetes API.
- `kind: Namespace` - Defines the resource type as a Namespace.
- `metadata.name: svd` - Names the namespace "svd". All subsequent resources will live here.

---

## 3. Database Layer (`database.yaml`)
This file makes the MariaDB database, including its credentials, initialization scripts, and persistent storage.

```yaml
apiVersion: v1
kind: Secret
metadata:
  name: db-secret
  namespace: svd
type: Opaque
stringData:
  DB_HOST: "mariadb"
  DB_USER: "svduser"
  DB_PASSWORD: "svdpass"
  DB_DATABASE: "svddb"
  MYSQL_ROOT_PASSWORD: "svdroot"
  MYSQL_DATABASE: "svddb"
  MYSQL_USER: "svduser"
  MYSQL_PASSWORD: "svdpass"
---
apiVersion: v1
kind: ConfigMap
metadata:
  name: db-init
  namespace: svd
data:
  init.sql: |
    CREATE TABLE IF NOT EXISTS names (name VARCHAR(255));
    INSERT INTO names (name) VALUES ('Simon Van Dessel');
---
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: mariadb-pvc
  namespace: svd
spec:
  accessModes: ["ReadWriteOnce"]
  resources:
    requests:
      storage: 2Gi
---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: mariadb
  namespace: svd
spec:
  replicas: 1
  selector:
    matchLabels:
      app: mariadb
  template:
    metadata:
      labels:
        app: mariadb
    spec:
      containers:
        - name: mariadb
          image: mariadb:10.5
          ports:
            - containerPort: 3306
          envFrom:
            - secretRef:
                name: db-secret
          resources:
            requests:
              memory: "256Mi"
              cpu: "100m"
            limits:
              memory: "512Mi"
              cpu: "500m"
          volumeMounts:
            - name: db-init
              mountPath: /docker-entrypoint-initdb.d
            - name: db-storage
              mountPath: /var/lib/mysql
      volumes:
        - name: db-init
          configMap:
            name: db-init
        - name: db-storage
          persistentVolumeClaim:
            claimName: mariadb-pvc
---
apiVersion: v1
kind: Service
metadata:
  name: mariadb
  namespace: svd
spec:
  selector:
    app: mariadb
  ports:
    - port: 3306
      targetPort: 3306
```

### Detailed Line-by-Line Explanation:

#### 1. Database Secret (`db-secret`)
This resource securely stores the credentials required for the database to function and for the API to connect.
- `apiVersion: v1`: Uses the base Kubernetes API version.
- `kind: Secret`: Identifies this as a tool for storing sensitive information.
- `metadata.name: db-secret`: The unique name for this secret within the namespace.
- `metadata.namespace: svd`: Places the secret in the "svd" namespace.
- `type: Opaque`: Indicates the secret contains arbitrary data (the most common type).
- `stringData`: Allows us to write secrets in plain text; Kubernetes will automatically Base64-encode them for us.
  - `DB_HOST`: The internal cluster address for the database.
  - `DB_USER/PASSWORD`: Credentials used by the Application to connect.
  - `MYSQL_ROOT_PASSWORD`: The administrative password for the MariaDB engine.
  - `MYSQL_DATABASE`: The name of the specific database to be created on startup.

#### 2. Init Script ConfigMap (`db-init`)
- `kind: ConfigMap`: Used for non-sensitive configuration data.
- `data.init.sql: |`: The `|` symbol allows for a multi-line string. This SQL script is executed automatically when the database starts for the first time.
  - `CREATE TABLE IF NOT EXISTS names...`: Ensures the database structure is ready.
  - `INSERT INTO names...`: Populates the database with initial data (your name).

#### 3. Persistent Storage (`mariadb-pvc`)
- `kind: PersistentVolumeClaim`: A request for storage that lives independently of the Pod. If the Pod crashes, the data stays safe.
- `spec.accessModes: ["ReadWriteOnce"]`: The volume can be mounted for reading and writing by exactly one node at a time.
- `resources.requests.storage: 2Gi`: Reserves 2 Gigabytes of disk space.

#### 4. MariaDB Deployment
- `kind: Deployment`: Manages the lifecycle of the database container.
- `spec.replicas: 1`: We only run one database instance to avoid data synchronization conflicts.
- `spec.selector.matchLabels`: Tells the Deployment which Pods it is responsible for managing.
- `template.spec.containers`: The actual definition of the MariaDB engine.
  - `image: mariadb:10.5`: The specific version of the MariaDB image to use.
  - `ports.containerPort: 3306`: The port the database listens on inside its container.
  - `envFrom.secretRef`: This is a powerful shortcut. It takes every key-value pair inside `db-secret` and injects them as environment variables into the container.
  - `resources`: Defines `requests` (guaranteed resources) and `limits` (maximum allowed resources) to prevent the database from consuming the entire host machine's power.
  - `volumeMounts`: Maps our "Volumes" to specific paths inside the container:
    - `/docker-entrypoint-initdb.d`: A special MariaDB folder. Any SQL scripts found here are executed at startup.
    - `/var/lib/mysql`: The standard path where MariaDB stores its actual data files. By mounting our PVC here, the data survives Pod restarts.

#### 5. Database Service
- `kind: Service`: Creates a stable network endpoint.
- `spec.ports.port: 3306`: The port that other apps inside the cluster will use to talk to the database.
- `spec.targetPort: 3306`: Routes traffic from the Service port to the actual Pod port.
- `spec.selector.app: mariadb`: Links the service to any Pod labeled with `app: mariadb`.

---

## 4. Backend Layer (`backend.yaml`)
Manages the FastAPI application that serves as the bridge between the frontend and the database.

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: api
  namespace: svd
spec:
  replicas: 2
  selector:
    matchLabels:
      app: api
  template:
    metadata:
      labels:
        app: api
      annotations:
        prometheus.io/scrape: "true"
        prometheus.io/port: "3000"
        prometheus.io/path: "/metrics"
    spec:
      containers:
        - name: api
          image: r1035222/ms2_backend:latest
          ports:
            - containerPort: 3000
          envFrom:
            - secretRef:
                name: db-secret
          resources:
            requests:
              memory: "128Mi"
              cpu: "100m"
            limits:
              memory: "512Mi"
              cpu: "500m"
          livenessProbe:
            httpGet:
              path: /api/name
              port: 3000
            initialDelaySeconds: 10
            periodSeconds: 5
          readinessProbe:
            httpGet:
              path: /api/name
              port: 3000
            initialDelaySeconds: 5
            periodSeconds: 5
---
apiVersion: v1
kind: Service
metadata:
  name: api
  namespace: svd
spec:
  selector:
    app: api
  ports:
    - port: 3000
      targetPort: 3000
```

### Detailed Line-by-Line Explanation:

#### 1. API Deployment
- `kind: Deployment`: Manages the rollout and scaling of the backend application.
- `spec.replicas: 2`: Ensures high availability by running two identical copies of the API.
- `spec.selector.matchLabels`: Connects the deployment to the Pods it creates.
- `template.metadata.annotations`:
  - `prometheus.io/scrape: "true"`: Explicitly tells Prometheus to collect data from these Pods.
  - `prometheus.io/port: "3000"`: Specifies which port the metrics endpoint lives on.
  - `prometheus.io/path: "/metrics"`: Defines the URL for the metrics.
- `template.spec.containers`:
  - `image: r1035222/ms2_backend:latest`: The custom-built Python/FastAPI image.
  - `ports.containerPort: 3000`: The internal port the application listens on.
  - `envFrom.secretRef`: Injects all database credentials from `db-secret`.
  - `resources`: Ensures the API has enough memory (128Mi-512Mi) and CPU (100m-500m) to perform well.
  - `livenessProbe`: Periodically checks if the app is still running. If `/api/name` stops responding, Kubernetes will kill and restart the container.
  - `readinessProbe`: Checks if the app is ready to take web traffic. This prevents users from getting errors while the app is still starting up.

#### 2. API Service
- `kind: Service`: Provides a single, stable IP address/DNS name (`api`) for the backend.
- `spec.ports.port: 3000`: The port other components (like the Frontend) use to reach the API.
- `spec.targetPort: 3000`: Sends that traffic to port 3000 inside the API pods.

---

## 5. Frontend Layer (`frontend.yaml`)
Handles the Lighttpd web server and the static UI.

```yaml
# 3. ConfigMap: lighttpd.conf (already has /api proxy)
apiVersion: v1
kind: ConfigMap
metadata:
  name: lighttpd-conf
  namespace: svd
data:
  lighttpd.conf: |
    server.document-root = "/var/www/html"
    server.port = 80
    mimetype.assign = ( ".html" => "text/html", ".js" => "text/javascript" )
    server.error-handler-404 = "/index.html"
    server.modules += ( "mod_proxy" )
    proxy.server = ( "/api" =>
      ( ( "host" => "api", "port" => 3000 ) )
    )
---
# 4. ConfigMap: real index.html
apiVersion: v1
kind: ConfigMap
metadata:
  name: html
  namespace: svd
data:
  index.html: |-
    <!DOCTYPE html>
    <html lang="en">
      <head>
        <meta charset="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <title>Milestone 2</title>
      </head>
      <body>
        <h1><span id="user">Loading...</span> has reached milestone 2!</h1>
        <p>Container ID: <strong id="cid">Loading...</strong></p>

        <script>
          // fetch name
          fetch("/api/name")
            .then(r => r.json())
            .then(d => document.getElementById("user").innerText = d.name)
            .catch(() => document.getElementById("user").innerText = "error");

          // fetch container ID (pod name)
          fetch("/api/container-id")
            .then(r => r.json())
            .then(d => document.getElementById("cid").innerText = d.container_id)
            .catch(() => document.getElementById("cid").innerText = "error");
        </script>
      </body>
        </html>
---
# 8. lighttpd Deployment + Service
apiVersion: apps/v1
kind: Deployment
metadata:
  name: frontend
  namespace: svd
spec:
  replicas: 1
  selector:
    matchLabels:
      app: frontend
  template:
    metadata:
      labels:
        app: frontend
    spec:
      containers:
        - name: frontend
          image: r1035222/ms2_frontend:latest
          ports:
            - containerPort: 80
          resources:
            requests:
              memory: "64Mi"
              cpu: "50m"
            limits:
              memory: "128Mi"
              cpu: "200m"
          volumeMounts:
            - name: conf
              mountPath: /etc/lighttpd/lighttpd.conf
              subPath: lighttpd.conf
            - name: html
              mountPath: /var/www/html
      volumes:
        - name: conf
          configMap:
            name: lighttpd-conf
        - name: html
          configMap:
            name: html
---
apiVersion: v1
kind: Service
metadata:
  name: frontend
  namespace: svd
spec:
  type: ClusterIP
  selector:
    app: frontend
  ports:
    - port: 8080
      targetPort: 80
```

### Detailed Line-by-Line Explanation:

#### 1. Lighttpd Configuration (`lighttpd-conf`)
This ConfigMap defines the behavior of our web server.
- `server.document-root`: Specifies `/var/www/html` as the folder where the server looks for files.
- `server.port = 80`: The server listens on the standard HTTP port inside the container.
- `mimetype.assign`: Tells the server how to handle different file types (HTML as text, JS as javascript).
- `server.error-handler-404 = "/index.html"`: A common "Single Page Application" trick. If someone visits a page that doesn't exist, it sends them back to the main page.
- `mod_proxy`: Enables the ability to forward requests to another server.
- `proxy.server = ( "/api" => ... )`: **The most important part**. It routes any request starting with `/api` (like `/api/name`) to our `api` service. This prevents Cross-Origin (CORS) errors because the browser thinks the request is going to the same server.

#### 2. HTML Content (`html`)
This ConfigMap stores our website's code directly in Kubernetes.
- `index.html`:
  - `<span id="user">`: A placeholder for the user's name.
  - `fetch("/api/name")`: The Javascript that calls our backend to get the name from the database.
  - `fetch("/api/container-id")`: Calls the backend to see which Pod handled the request (useful for testing scaling).

#### 3. Frontend Deployment
- `kind: Deployment`: Ensures one instance (`replicas: 1`) of the web server is always running.
- `image: r1035222/ms2_frontend:latest`: A specialized Docker image that contains the Lighttpd binary.
- `resources`: Keeps the frontend lightweight by limiting it to 128MB of RAM.
- `volumeMounts`:
  - `mountPath: /etc/lighttpd/lighttpd.conf`: We take our custom config and "glue" it over the top of the default one inside the container.
  - `subPath: lighttpd.conf`: Tells Kubernetes to only replace that specific file, not the whole folder.
  - `mountPath: /var/www/html`: Overwrites the website folder with our `index.html` from the ConfigMap.

#### 4. Frontend Service
The service makes the website accessible within the cluster.
- `type: ClusterIP`: This makes the service only reachable internally. We rely on the Ingress to provide external access. This is more secure than a NodePort.
- `port: 8080`: The internal port that other services (like Ingress) use to talk to the frontend.
- `targetPort: 80`: Routes traffic to the web server's internal port.

---

## 6. Ingress & TLS (`ingress.yaml`)
Defines how external traffic reaches the frontend and how HTTPS is handled.

```yaml
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: ingress
  namespace: svd
  annotations:
    cert-manager.io/cluster-issuer: selfsigned-cluster-issuer
spec:
  ingressClassName: traefik
  tls:
    - hosts:
        - milestone2.example.com
      secretName: milestone2-tls
  rules:
    - host: milestone2.example.com
      http:
        paths:
          - path: /
            pathType: Prefix
            backend:
              service:
                name: frontend
                port:
                  number: 8080
```

### Detailed Line-by-Line Explanation:

#### 1. Ingress Metadata
- `kind: Ingress`: The "traffic cop" of the cluster. It routes external domains to internal services.
- `annotations`:
  - `cert-manager.io/cluster-issuer`: Instructs Cert-Manager to automatically issue a security certificate for this connection.

#### 2. Ingress Spec
- `ingressClassName: traefik`: Tells the cluster that **Traefik** is the controller that will handle this traffic.
- `tls`:
  - `hosts`: The domain name to protect with HTTPS.
  - `secretName: milestone2-tls`: The name of the secret where the SSL/TLS certificate will be stored.
- `rules.host`: Defines that this rule only applies when someone visits `milestone2.example.com`.
- `http.paths`:
  - `path: /`: Matches everything (the root of the site).
  - `backend.service`: Sends the traffic to the `frontend` service on port `8080`.

---

## 7. GitOps with Argo CD (`argo-cd.yaml`)
Ensures that the state of your cluster matches the state of your GitHub repository.

```yaml
apiVersion: argoproj.io/v1alpha1
kind: Application
metadata:
  name: argocd-app
  namespace: argocd
spec:
  project: default
  source:
    repoURL: "https://github.com/simon-vd/AgroCD.git"
    targetRevision: HEAD
    path: .
  destination:
    server: "https://kubernetes.default.svc"
    namespace: svd
  syncPolicy:
    automated:
      prune: true
      selfHeal: true
```

### Detailed Line-by-Line Explanation:

#### 1. Application Metadata
- `kind: Application`: An Argo CD specific resource that defines a "project" to be synchronized.
- `metadata.namespace: argocd`: Argo CD resources must live in their own namespace.

#### 2. Synchronization Spec
- `source.repoURL`: The link to your GitHub repository. This is the **Source of Truth**.
- `source.path: .`: Argo CD will search the root of your repo for any `.yaml` files.
- `destination.namespace: svd`: Even though the Argo CD config is in the `argocd` namespace, it will deploy your app into the `svd` namespace.
- `syncPolicy.automated`:
  - `prune: true`: If you delete a file from GitHub, Argo CD will automatically delete the matching resource from the cluster.
  - `selfHeal: true`: If someone manually changes something in the cluster (e.g., manually editing a deployment), Argo CD will overwrite it to match what is on GitHub.

---

## Conclusion
This architecture provides a scalable, secure, and automated environment. By decoupling configuration (ConfigMaps/Secrets) from code (Docker images) and using GitOps (Argo CD), you ensure that your deployment is both professional and easy to maintain.

Key takeaways from this setup:
1.  **Security First**: Sensitive data is managed via Secrets, and external traffic is secured with TLS certificates managed by Cert-Manager.
2.  **Scalability**: The Backend layer is configured with multiple replicas, which Kubernetes automatically balances across multiple worker nodes.
3.  **Modern Networking**: By moving from NodePort to a structured Ingress (Traefik), we allow for domain-based routing and a cleaner external interface.
4.  **Automation (GitOps)**: Using Argo CD means your cluster's "live" state is always synchronized with your GitHub repository, providing a clear history of changes and preventing "configuration drift."

This setup serves as a robust foundation for any cloud-native application, demonstrating a high level of technical maturity in Kubernetes management.

> **Screenshot placeholders**:
> `![Cluster Overview](./assets/cluster_status.png)`
> `![Argo CD Sync](./assets/argocd_sync.png)`
> `![Frontend UI](./assets/frontend_success.png)`

---
*End of Documentation*
