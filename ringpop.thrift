struct Change {
    1: required string source;
    2: required string address;
    3: required string status;
    4: required double incarnationNumber;
}

struct Ack {
    1: optional list<Change> changes;
    2: optional double membershipChecksum;
}

struct DenyingJoinsError {
    1: required string type;
    2: required string message;
}

struct InvalidJoinAppError {
    1: required string type;
    2: required string message;
}

struct InvalidJoinSourceError {
    1: required string type;
    2: required string message;
}

struct PingReqTargetUnreachableError {
    1: required string type;
    2: required string message;
    3: optional list<Change> changes;
}

service Ringpop {
    Ack join(
        1: required string app,
        2: required string source,
        3: required double incarnationNumber
    ) throws (
        1: DenyingJoinsError denyingJoins,
        2: InvalidJoinAppError invalidJoinApp,
        3: InvalidJoinSourceError invalidJoinSource
    );

    Ack ping(
        1: required double checksum,
        2: optional list<Change> changes,
        3: required string source,
        4: required double sourceIncarnationNumber
    );

    Ack pingReq(
        1: required double checksum,
        2: optional list<Change> changes,
        3: required string target,
        4: required string source,
        5: required double sourceIncarnationNumber
    ) throws (
        1: PingReqTargetUnreachableError pingReqTargetUnreachable
    );
}
