/* FATES-005A guest init source. Build as a static binary and place at /init
 * in a fresh initrd. This source deliberately has no shell, model runtime,
 * provider client, credential store, or host authority state. */
#define _GNU_SOURCE

#include <errno.h>
#include <fcntl.h>
#include <linux/vm_sockets.h>
#include <signal.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/mount.h>
#include <sys/socket.h>
#include <sys/stat.h>
#include <time.h>
#include <unistd.h>

#define MAX_FRAME_BYTES (64U * 1024U)
#define MAX_VALUE_BYTES 256U

static int read_cmdline_value(const char *key, char *out, size_t out_size) {
    int fd = open("/proc/cmdline", O_RDONLY | O_CLOEXEC);
    if (fd < 0) return -1;
    char cmdline[4096];
    ssize_t length = read(fd, cmdline, sizeof(cmdline) - 1);
    close(fd);
    if (length <= 0) return -1;
    cmdline[length] = '\0';
    size_t key_length = strlen(key);
    char *cursor = cmdline;
    while (cursor < cmdline + length) {
        while (*cursor == ' ' || *cursor == '\n' || *cursor == '\r' || *cursor == '\t') cursor++;
        char *end = strpbrk(cursor, " \n\r\t");
        if (end == NULL) end = cmdline + length;
        if ((size_t)(end - cursor) > key_length + 1 && strncmp(cursor, key, key_length) == 0 && cursor[key_length] == '=') {
            size_t value_length = (size_t)(end - cursor) - key_length - 1;
            if (value_length == 0 || value_length >= out_size) return -1;
            memcpy(out, cursor + key_length + 1, value_length);
            out[value_length] = '\0';
            return 0;
        }
        cursor = end;
    }
    return -1;
}

static int valid_value(const char *value, int allow_slash) {
    size_t length = strlen(value);
    if (length == 0 || length > MAX_VALUE_BYTES) return 0;
    for (size_t index = 0; index < length; index++) {
        unsigned char c = (unsigned char)value[index];
        int allowed = (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9') || c == '.' || c == '_' || c == ':' || c == '-';
        if (allow_slash) allowed = allowed || c == '/';
        if (!allowed) return 0;
    }
    return 1;
}

static int write_all(int fd, const char *buffer, size_t length) {
    size_t written = 0;
    while (written < length) {
        ssize_t result = write(fd, buffer + written, length - written);
        if (result < 0 && errno == EINTR) continue;
        if (result <= 0) return -1;
        written += (size_t)result;
    }
    return 0;
}

static ssize_t read_line(int fd, char *buffer, size_t capacity) {
    size_t length = 0;
    while (length + 1 < capacity) {
        char c;
        ssize_t result = read(fd, &c, 1);
        if (result < 0 && errno == EINTR) continue;
        if (result <= 0) return -1;
        if (c == '\n') {
            buffer[length] = '\0';
            return (ssize_t)length;
        }
        buffer[length++] = c;
    }
    return -1;
}

static void sleep_millis(unsigned int milliseconds) {
    struct timespec delay = {
        .tv_sec = (time_t)(milliseconds / 1000U),
        .tv_nsec = (long)((milliseconds % 1000U) * 1000000U),
    };
    while (nanosleep(&delay, &delay) != 0 && errno == EINTR) {
    }
}

int main(void) {
    mkdir("/proc", 0755);
    (void)mount("proc", "/proc", "proc", 0, NULL);

    char session_id[MAX_VALUE_BYTES + 1];
    char request_id[MAX_VALUE_BYTES + 1];
    char correlation_id[MAX_VALUE_BYTES + 1];
    char source_id[MAX_VALUE_BYTES + 1];
    char source_hash[MAX_VALUE_BYTES + 1];
    char memory_id[MAX_VALUE_BYTES + 1];
    char idempotency_key[MAX_VALUE_BYTES + 1];
    char port_text[32];
    const struct { const char *key; char *value; size_t size; int allow_slash; } fields[] = {
        {"fates.session", session_id, sizeof(session_id), 0},
        {"fates.request_id", request_id, sizeof(request_id), 0},
        {"fates.correlation_id", correlation_id, sizeof(correlation_id), 0},
        {"fates.source_id", source_id, sizeof(source_id), 1},
        {"fates.source_hash", source_hash, sizeof(source_hash), 0},
        {"fates.memory_id", memory_id, sizeof(memory_id), 0},
        {"fates.idempotency_key", idempotency_key, sizeof(idempotency_key), 0},
        {"fates.vsock_port", port_text, sizeof(port_text), 0},
    };
    for (size_t index = 0; index < sizeof(fields) / sizeof(fields[0]); index++) {
        if (read_cmdline_value(fields[index].key, fields[index].value, fields[index].size) != 0 || !valid_value(fields[index].value, fields[index].allow_slash)) return 10;
    }
    char *end = NULL;
    unsigned long port = strtoul(port_text, &end, 10);
    if (*port_text == '\0' || *end != '\0' || port == 0 || port > 0xffffffffUL || strlen(source_hash) != 64) return 11;

    int fd = -1;
    struct sockaddr_vm address;
    memset(&address, 0, sizeof(address));
    address.svm_family = AF_VSOCK;
    address.svm_cid = VMADDR_CID_HOST;
    address.svm_port = (unsigned int)port;
    for (unsigned int attempt = 0; attempt < 600U; attempt++) {
        fd = socket(AF_VSOCK, SOCK_STREAM | SOCK_CLOEXEC, 0);
        if (fd < 0) return 20;
        if (connect(fd, (struct sockaddr *)&address, sizeof(address)) == 0) break;
        int connect_error = errno;
        close(fd);
        fd = -1;
        if (connect_error != ENOENT && connect_error != ECONNREFUSED && connect_error != ECONNRESET && connect_error != EAGAIN) return 21;
        sleep_millis(100U);
    }
    if (fd < 0) return 21;

    char proposal[MAX_FRAME_BYTES];
    int proposal_length = snprintf(proposal, sizeof(proposal),
        "{\"version\":\"1\",\"sessionId\":\"%s\",\"requestId\":\"%s\",\"method\":\"proposal.submit\",\"payload\":{\"action\":\"governed.memory-admission\",\"sourceId\":\"%s\",\"sourceHash\":\"%s\",\"memoryId\":\"%s\",\"idempotencyKey\":\"%s\",\"correlationId\":\"%s\"}}\n",
        session_id, request_id, source_id, source_hash, memory_id, idempotency_key, correlation_id);
    if (proposal_length <= 0 || (size_t)proposal_length >= sizeof(proposal) || write_all(fd, proposal, (size_t)proposal_length) != 0) {
        close(fd);
        return 22;
    }

    char response[MAX_FRAME_BYTES];
    if (read_line(fd, response, sizeof(response)) < 0) {
        close(fd);
        return 23;
    }
    dprintf(STDOUT_FILENO, "%s\n", response);
    if (strstr(response, "\"method\":\"proposal.result\"") == NULL || strstr(response, "\"action\":\"ALLOW\"") == NULL) {
        close(fd);
        return 24;
    }
    close(fd);
    for (;;) pause();
}
