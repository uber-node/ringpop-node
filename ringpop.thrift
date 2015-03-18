struct Change {
    1: required string source;
    2: required string address;
    3: required string status; // TODO Make this an enum?
    4: required double incarnationNumber;
}

struct JoinResult {
    1: required string app;
    2: required string coordinator;
    3: required list<Change> membership;
}

struct PingResult {
    1: required list<Change> changes;
}

struct PingReqResult {
    1: required string target;
    2: required bool isOk;
    3: required list<Change> changes;
}

service Ringpop {
    JoinResult join(1:string app, 2:string source, 3:double incarnationNumber);
    PingResult ping(1:double checksum, 2:list<Change> changes, 3:string source);
    PingReqResult pingReq(1:double checksum, 2:list<Change> changes, 3:string source, 4:string target);
}
