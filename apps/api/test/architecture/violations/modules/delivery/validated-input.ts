// Violation fixture (rule no-validation-libraries, doc 3 §9, A-17): a validation library the API
// does not use; input is parsed by the kernel ContractPipe with the generated strict schemas.
// The package is not installed, which is the point: the rule matches the name as written.
// @ts-expect-error -- deliberately not installed
import 'class-validator';
