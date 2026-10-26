{{- define "cp.name" -}}{{ .Release.Name }}-cloudplay{{- end -}}
{{- define "cp.labels" -}}
app.kubernetes.io/name: cloudplay
app.kubernetes.io/instance: {{ .Release.Name }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- end -}}
{{- define "cp.sel" -}}
app.kubernetes.io/name: cloudplay
app.kubernetes.io/instance: {{ (index . 0).Release.Name }}
app.kubernetes.io/component: {{ index . 1 }}
{{- end -}}
{{/* Secreto estable: se reutiliza el valor ya guardado en el clúster en cada upgrade */}}
{{- define "cp.secret" -}}
{{- $ctx := index . 0 -}}{{- $key := index . 1 -}}{{- $len := index . 2 -}}
{{- $existing := lookup "v1" "Secret" $ctx.Release.Namespace (include "cp.name" $ctx) -}}
{{- if and $existing (index $existing.data $key) -}}{{ index $existing.data $key | b64dec }}{{- else -}}{{ randAlphaNum $len }}{{- end -}}
{{- end -}}
{{- define "cp.dbUrl" -}}
{{- if .Values.postgres.externalUrl -}}{{ .Values.postgres.externalUrl }}{{- else -}}
postgresql+asyncpg://cloudplay:$(POSTGRES_PASSWORD)@{{ include "cp.name" . }}-postgres:5432/cloudplay
{{- end -}}
{{- end -}}
