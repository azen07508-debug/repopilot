import { Counter } from "../contracts/Counter.sol";

contract CounterTest {
  function testIncrement() public {
    Counter c = new Counter();
    c.increment();
    require(c.count() == 1, "count should be 1");
  }
}
