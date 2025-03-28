from opentelemetry import trace
from opentelemetry.exporter.otlp.proto.grpc.trace_exporter import OTLPSpanExporter
# from opentelemetry.exporter.otlp.proto.http.trace_exporter import OTLPSpanExporter  # HTTP exporter
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import BatchSpanProcessor
from opentelemetry.instrumentation.requests import RequestsInstrumentor
import requests

# Set up OpenTelemetry tracing
trace.set_tracer_provider(TracerProvider())
tracer = trace.get_tracer(__name__)

# Configure OTLP exporter to send data to the OpenTelemetry Collector
otlp_exporter = OTLPSpanExporter(endpoint="http://localhost:4317", insecure=True)
# otlp_exporter = OTLPSpanExporter(endpoint="http://localhost:4318/v1/traces")
span_processor = BatchSpanProcessor(otlp_exporter)
trace.get_tracer_provider().add_span_processor(span_processor)

# Instrument requests
RequestsInstrumentor().instrument()

# Example function to send a trace
def fetch_data(url):
    with tracer.start_as_current_span("fetch_data") as span:
        response = requests.get(url)
        span.set_attribute("http.status_code", response.status_code)
        span.set_attribute("http.url", url)
        return response.text

# Example usage
if __name__ == "__main__":
    fetch_data("https://www.google.com")
    print("Trace data sent to OpenTelemetry Collector")
