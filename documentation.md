# Kubernetes Stack Documentation

## Introduction
This document provides a detailed, professional overview of the Kubernetes infrastructure used for this project. It is designed to be easily reproducible, with deep-dive explanations for every configuration file. The stack utilizes **Kind** for local cluster management, **Traefik** as an Ingress controller, **Cert-Manager** for TLS automation, and **Argo CD** for GitOps synchronization.

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
- `- role: worker` - Adds a worker node to the cluster for scaling and distribution.
- `- role: worker` - Adds a second worker node.

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
- `metadata:` - Metadata block.
- `  name: svd` - Names the namespace "svd". All subsequent resources will live here.

---

## 3. Database Layer (`database.yaml`)
This file orchestrates the MariaDB database, including its credentials, initialization scripts, and persistent storage.

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

### Line-by-line explanation:
**Database Secret**
- `kind: Secret` - Stores sensitive data.
- `type: Opaque` - Default secret type (arbitrary data).
- `stringData:` - Allows providing secrets in plain text (Kubernetes encodes them to base64 automatically).
- `DB_PASSWORD: "svdpass"` - Password used by the API to connect to MariaDB.
- `MYSQL_ROOT_PASSWORD: "svdroot"` - The root password for the MariaDB server.

**Init Script (ConfigMap)**
- `kind: ConfigMap` - Stores non-sensitive config data.
- `init.sql: |` - Defines a multi-line SQL script.
- `INSERT INTO names...` - Injects your name into the database on first run.

**Persistent Storage (PVC)**
- `kind: PersistentVolumeClaim` - Requests a piece of storage from the cluster.
- `accessModes: ["ReadWriteOnce"]` - The volume can be mounted as read-write by a single node.
- `storage: 2Gi` - Requests 2 Gigabytes of disk space for the database files.

**MariaDB Deployment**
- `image: mariadb:10.5` - Uses the official MariaDB 10.5 image.
- `envFrom: - secretRef:` - Loads all key-value pairs from `db-secret` as environment variables.
- `resources:` - Sets memory and CPU limits to ensure cluster stability.
- `volumeMounts:` - Connects the initialization script and the persistent storage to the container.
- `/docker-entrypoint-initdb.d` - Standard MariaDB path; any SQL here runs during startup.

**MariaDB Service**
- `kind: Service` - Creates an internal network alias `mariadb.svd.svc.cluster.local`.
- `port: 3306` - The port accessible to other pods (like the API).

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

### Line-by-line explanation:
**API Deployment**
- `replicas: 2` - Runs two instances of the API for high availability.
- `annotations:` - Metadata for Prometheus to automatically find and scrape metrics from port 3000.
- `image: r1035222/ms2_backend:latest` - Custom FastAPI image.
- `livenessProbe:` - Kubernetes check to see if the container is still alive. If it fails, Kubernetes restarts it.
- `readinessProbe:` - Kubernetes check to see if the container is ready to handle traffic.
- `initialDelaySeconds:` - Wait time before starting the checks to allow the app to boot.

**API Service**
- `port: 3000` - Internal cluster port for communication.
- `targetPort: 3000` - Routes traffic to port 3000 on the API pods.

---

## 5. Frontend Layer (`frontend.yaml`)
Handles the Lighttpd web server and the static UI.

```yaml
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
```

### Line-by-line explanation:
**Lighttpd Config**
- `server.port = 80` - Lighttpd listens on standard port 80.
- `mod_proxy` - Enables proxying.
- `proxy.server = ( "/api" => ... )` - **Critical line**: Redirects any web request starting with `/api` to the backend service. This avoids Cross-Origin (CORS) issues.

*(Note: The deployment and service follow the same pattern as the API, using NodePort 30080 for direct host access).*

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

### Line-by-line explanation:
**Ingress Metadata**
- `kind: Ingress` - An API object that manages external access to services (typically HTTP).
- `cert-manager.io/cluster-issuer` - Tells Cert-Manager to use the "selfsigned-cluster-issuer" to generate a TLS certificate.

**Ingress Rules**
- `ingressClassName: traefik` - Specifies that Traefik should handle this ingress.
- `tls:` - Configures HTTPS.
- `secretName: milestone2-tls` - Where Cert-Manager will store the generated certificate.
- `host: milestone2.example.com` - The domain name used to route traffic.
- `backend: service: name: frontend` - Tells the ingress to send traffic to the "frontend" service on port 8080.

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

### Line-by-line explanation:
- `kind: Application` - A Custom Resource (CRD) defined by Argo CD.
- `repoURL:` - The source of truth (your GitHub repo).
- `path: .` - Argo CD looks for YAML files in the root of the repo.
- `destination: namespace: svd` - Deploys everything into the `svd` namespace.
- `syncPolicy: automated:` - Enables automatic syncing.
- `prune: true` - Automatically deletes resources in the cluster that are removed from Git.
- `selfHeal: true` - Automatically reverts manual changes made to the cluster if they don't match Git.

---

## Conclusion
This architecture provides a scalable, secure, and automated environment. By decoupling configuration (ConfigMaps/Secrets) from code (Docker images) and using GitOps (Argo CD), you ensure that your deployment is both professional and easy to maintain.

> **Screenshot placeholders**:
> `![Cluster Overview](./assets/cluster_status.png)`
> `![Argo CD Sync](./assets/argocd_sync.png)`
> `![Frontend UI](./assets/frontend_success.png)`

---
*End of Documentation*
